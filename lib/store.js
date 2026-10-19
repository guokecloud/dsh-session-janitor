/**
 * dsh-session-janitor · 纯文件系统逻辑（不依赖 DSH，可单独用 node 测试）
 *
 * 目标目录（root 默认 ~/.dsh，可用 opts.root 覆盖以便测试）：
 *   sessions/<项目文件夹>/<会话文件夹>/session.v4.jsonl.zstd   会话正文
 *   storages/session_projcache/sessions/<sessionId>.json        列表缓存（标题/cwd）
 *   storages/session_projcache_archive_manager_v2/sessions/*.json  已裁剪归档缓存
 *   session-trash/<时间戳>/...                                   本插件自己的回收站
 *
 * 删除 = 移动进回收站（可恢复），绝不直接 unlink。
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";

export const DEFAULT_ROOT = join(homedir(), ".dsh");
export const SESSIONS_REL = join("sessions");
export const PROJCACHE_REL = join("storages", "session_projcache", "sessions");
export const ARCHIVE_REL = join("storages", "session_projcache_archive_manager_v2", "sessions");
export const TRASH_REL = "session-trash";

const SAFE_NAME = /^[A-Za-z0-9._@+-]{1,200}$/;
/** 最近这段时间内被写过的会话一律视为“正在使用”，默认拒绝删除 */
export const DEFAULT_LIVE_MS = 10 * 60 * 1000;

export function assertSafeName(name, what = "名称") {
  if (typeof name !== "string" || name.length === 0 || !SAFE_NAME.test(name) || name.includes("..")) {
    throw new Error(`${what}非法: ${String(name)}`);
  }
  return name;
}

/** 目标必须在 root 之内（防目录穿越） */
function assertInside(child, parent) {
  const c = resolve(child);
  const p = resolve(parent);
  if (c !== p && !c.startsWith(p.endsWith(sep) ? p : p + sep)) {
    throw new Error(`路径越过 root: ${c}`);
  }
  return c;
}

function listDirs(p) {
  if (!existsSync(p)) return [];
  try {
    return readdirSync(p, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !d.name.startsWith("."))
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function listFiles(p) {
  if (!existsSync(p)) return [];
  try {
    return readdirSync(p, { withFileTypes: true })
      .filter((d) => d.isFile())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function statOf(p) {
  try {
    return statSync(p);
  } catch {
    return null;
  }
}

export function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, "utf8"));
  } catch {
    return null;
  }
}

/** 递归统计占用（失败当 0，不抛） */
export function sizeOf(p) {
  const st = statOf(p);
  if (!st) return 0;
  if (st.isFile()) return st.size;
  if (!st.isDirectory()) return 0;
  let total = 0;
  try {
    for (const e of readdirSync(p, { withFileTypes: true })) {
      total += sizeOf(join(p, e.name));
    }
  } catch {
    /* ignore */
  }
  return total;
}

function pick(obj, path) {
  let cur = obj;
  for (const key of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = cur[key];
  }
  return cur;
}

function firstString(obj, paths) {
  for (const p of paths) {
    const v = pick(obj, p);
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return "";
}

function firstNumber(obj, paths) {
  for (const p of paths) {
    const v = pick(obj, p);
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

/**
 * 会话“最后活动时间” = 会话目录里最新那个 .zstd 的 mtime
 * （DSH 是往 session.v4.jsonl.zstd 追加写入的；目录本身的 mtime 不可靠）
 */
function sessionMtime(dir) {
  let mtime = 0;
  let file = null;
  for (const f of listFiles(dir)) {
    if (!f.endsWith(".zstd")) continue;
    const st = statOf(join(dir, f));
    if (st && st.mtimeMs > mtime) {
      mtime = st.mtimeMs;
      file = f;
    }
  }
  if (mtime === 0) {
    const st = statOf(dir);
    mtime = st ? st.mtimeMs : 0;
  }
  return { mtime, file };
}

function paths(root) {
  return {
    root,
    sessions: join(root, SESSIONS_REL),
    projcache: join(root, PROJCACHE_REL),
    archive: join(root, ARCHIVE_REL),
    trash: join(root, TRASH_REL)
  };
}

/** 列出所有会话 / 归档 / 回收站内容 */
export function list(opts = {}) {
  const root = resolve(opts.root ?? DEFAULT_ROOT);
  const now = opts.now ?? Date.now();
  const liveMs = opts.liveMs ?? DEFAULT_LIVE_MS;
  const p = paths(root);

  const sessions = [];
  for (const project of listDirs(p.sessions)) {
    for (const id of listDirs(join(p.sessions, project))) {
      const dir = join(p.sessions, project, id);
      const { mtime, file } = sessionMtime(dir);
      const cachePath = join(p.projcache, `${id}.json`);
      const cache = readJson(cachePath) ?? {};
      const size = sizeOf(dir);
      sessions.push({
        kind: "session",
        id,
        project,
        file,
        path: dir,
        size,
        mtime,
        ageMs: mtime > 0 ? now - mtime : null,
        live: mtime > 0 && now - mtime < liveMs,
        hasCache: existsSync(cachePath),
        title: firstString(cache, [
          ["record", "rows", "title", "val"],
          ["title"],
          ["record", "title"],
          ["meta", "title"]
        ]),
        cwd: firstString(cache, [["record", "identity", "cwd"], ["identity", "cwd"], ["record", "cwd"], ["cwd"]]),
        turns: firstNumber(cache, [["record", "rows", "titleInput", "val", "count"]]),
        createdAt: firstNumber(cache, [["record", "identity", "createdAt"], ["createdAt"]]),
        updatedAt: firstNumber(cache, [["updatedAt"], ["record", "updatedAt"], ["mtime"]])
      });
      const last = sessions[sessions.length - 1];
      last.messages = last.turns;
    }
  }
  sessions.sort((a, b) => b.mtime - a.mtime);

  const archives = [];
  for (const f of listFiles(p.archive)) {
    if (!f.endsWith(".json")) continue;
    const full = join(p.archive, f);
    const st = statOf(full);
    const j = readJson(full) ?? {};
    archives.push({
      kind: "archive",
      id: firstString(j, [["record", "sessionId"], ["sessionId"], ["session_id"], ["id"]]) || f,
      file: f,
      project: basename(firstString(j, [["identity", "cwd"], ["record", "identity", "cwd"], ["cwd"]]) || ""),
      cwd: firstString(j, [["identity", "cwd"], ["record", "identity", "cwd"], ["cwd"]]),
      title: firstString(j, [
        ["record", "rows", "title", "val"],
        ["record", "title"],
        ["title"]
      ]),
      size: st ? st.size : 0,
      mtime: st ? st.mtimeMs : 0,
      ageMs: st ? now - st.mtimeMs : null
    });
  }
  archives.sort((a, b) => b.mtime - a.mtime);

  const trash = trashList({ root, now });
  const sum = (arr, k) => arr.reduce((acc, x) => acc + (x[k] || 0), 0);

  return {
    root,
    now,
    liveMs,
    sessions,
    archives,
    trash,
    totals: {
      sessionCount: sessions.length,
      sessionBytes: sum(sessions, "size"),
      archiveCount: archives.length,
      archiveBytes: sum(archives, "size"),
      trashCount: trash.entries.length,
      trashBytes: sum(trash.entries, "size"),
      liveCount: sessions.filter((s) => s.live).length
    }
  };
}

function stamp(now) {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function movePath(src, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  try {
    renameSync(src, dest);
  } catch (err) {
    // 跨卷 / 占用重试一次：改为复制后删除
    if (err && (err.code === "EXDEV" || err.code === "EPERM" || err.code === "EACCES" || err.code === "EBUSY")) {
      cpSync(src, dest, { recursive: true, force: true });
      rmSync(src, { recursive: true, force: true });
    } else {
      throw err;
    }
  }
  return dest;
}

function readManifest(dir) {
  const j = readJson(join(dir, "manifest.json"));
  return Array.isArray(j) ? j : [];
}

function writeManifest(dir, entries) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(entries, null, 2), "utf8");
}

/**
 * 把所选条目移入回收站。
 * items: [{kind:"session", project, id} | {kind:"archive", file}]
 */
export function trashItems(items, opts = {}) {
  const root = resolve(opts.root ?? DEFAULT_ROOT);
  const now = opts.now ?? Date.now();
  const liveMs = opts.liveMs ?? DEFAULT_LIVE_MS;
  const force = opts.force === true;
  const p = paths(root);
  const bucket = join(p.trash, stamp(now));
  assertInside(bucket, p.trash);
  const manifest = readManifest(bucket);
  const moved = [];
  const failed = [];

  for (const raw of Array.isArray(items) ? items : []) {
    const item = raw ?? {};
    try {
      if (item.kind === "session") {
        const project = assertSafeName(item.project, "项目名");
        const id = assertSafeName(item.id, "会话 id");
        const src = join(p.sessions, project, id);
        assertInside(src, p.sessions);
        if (!existsSync(src)) throw new Error("会话目录不存在（可能已被删除）");
        const { mtime: lastWrite } = sessionMtime(src);
        const bytes = sizeOf(src);
        if (!force && lastWrite > 0 && now - lastWrite < liveMs) {
          const mins = Math.max(1, Math.round((now - lastWrite) / 60000));
          throw new Error(`最近 ${mins} 分钟还在写入（正在使用），已阻止`);
        }
        const dest = join(bucket, "sessions", project, id);
        movePath(src, dest);
        const cacheSrc = join(p.projcache, `${id}.json`);
        let cacheDest = null;
        if (existsSync(cacheSrc)) {
          cacheDest = movePath(cacheSrc, join(bucket, "projcache", `${id}.json`));
        }
        const entry = { kind: "session", project, id, bytes, at: now, from: src, to: dest, cacheFrom: existsSync(cacheSrc) ? cacheSrc : null, cacheTo: cacheDest };
        manifest.push(entry);
        moved.push({ kind: "session", id, project, bytes, trash: `${basename(bucket)}:${manifest.length - 1}` });
      } else if (item.kind === "archive") {
        const file = assertSafeName(item.file, "归档文件名");
        if (!file.endsWith(".json")) throw new Error("归档文件名必须以 .json 结尾");
        const src = join(p.archive, file);
        assertInside(src, p.archive);
        if (!existsSync(src)) throw new Error("归档条目不存在（可能已被删除）");
        const st = statOf(src);
        const bytes = st ? st.size : 0;
        const dest = movePath(src, join(bucket, "archive", file));
        const entry = { kind: "archive", file, bytes, at: now, from: src, to: dest };
        manifest.push(entry);
        moved.push({ kind: "archive", id: file, bytes, trash: `${basename(bucket)}:${manifest.length - 1}` });
      } else {
        throw new Error(`未知类型: ${String(item.kind)}`);
      }
    } catch (err) {
      failed.push({ kind: item.kind, id: item.id ?? item.file ?? "?", error: err && err.message ? err.message : String(err) });
    }
  }

  if (manifest.length > 0) writeManifest(bucket, manifest);
  // 空桶（全失败）不留垃圾目录
  if (manifest.length === 0 && existsSync(bucket)) {
    try {
      rmSync(bucket, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  return { moved, failed, bucket: manifest.length > 0 ? basename(bucket) : null };
}

/** 回收站内容 */
export function trashList(opts = {}) {
  const root = resolve(opts.root ?? DEFAULT_ROOT);
  const now = opts.now ?? Date.now();
  const p = paths(root);
  const entries = [];
  for (const bucket of listDirs(p.trash)) {
    const dir = join(p.trash, bucket);
    const manifest = readManifest(dir);
    manifest.forEach((entry, index) => {
      const to = typeof entry.to === "string" ? entry.to : "";
      entries.push({
        trashId: `${bucket}:${index}`,
        bucket,
        index,
        kind: entry.kind,
        id: entry.id ?? entry.file ?? "?",
        project: entry.project ?? "",
        bytes: entry.bytes ?? 0,
        at: entry.at ?? 0,
        stillThere: to.length > 0 && existsSync(to),
        from: entry.from ?? ""
      });
    });
  }
  entries.sort((a, b) => b.at - a.at);
  const sum = entries.reduce((acc, e) => acc + (e.bytes || 0), 0);
  return { entries, bytes: sum, bucketCount: listDirs(p.trash).length, now };
}

/** 从回收站恢复指定条目 */
export function restoreItems(trashIds, opts = {}) {
  const root = resolve(opts.root ?? DEFAULT_ROOT);
  const p = paths(root);
  const restored = [];
  const failed = [];
  const byBucket = new Map();
  for (const raw of Array.isArray(trashIds) ? trashIds : []) {
    const text = String(raw ?? "");
    const idx = text.lastIndexOf(":");
    if (idx <= 0) {
      failed.push({ id: text, error: "回收站条目编号格式不对" });
      continue;
    }
    const bucket = text.slice(0, idx);
    const index = Number.parseInt(text.slice(idx + 1), 10);
    if (!SAFE_NAME.test(bucket) || !Number.isInteger(index) || index < 0) {
      failed.push({ id: text, error: "回收站条目编号非法" });
      continue;
    }
    if (!byBucket.has(bucket)) byBucket.set(bucket, []);
    byBucket.get(bucket).push(index);
  }

  for (const [bucket, indexes] of byBucket) {
    const dir = join(p.trash, bucket);
    const manifest = readManifest(dir);
    if (manifest.length === 0) {
      failed.push({ id: bucket, error: "回收站清单缺失" });
      continue;
    }
    const keep = [];
    manifest.forEach((entry, i) => {
      if (!indexes.includes(i)) {
        keep.push(entry);
        return;
      }
      try {
        const to = typeof entry.to === "string" ? entry.to : "";
        const from = typeof entry.from === "string" ? entry.from : "";
        if (!to || !from) throw new Error("清单缺少路径");
        if (!existsSync(to)) throw new Error("回收站内的文件已不存在");
        if (existsSync(from)) throw new Error("原位置已被占用，无法恢复");
        movePath(to, from);
        if (entry.cacheTo && existsSync(entry.cacheTo)) {
          const cacheBack = entry.cacheFrom ?? join(p.projcache, `${entry.id}.json`);
          if (!existsSync(cacheBack)) movePath(entry.cacheTo, cacheBack);
        }
        restored.push({ id: entry.id ?? entry.file ?? "?", kind: entry.kind });
      } catch (err) {
        keep.push(entry);
        failed.push({ id: entry.id ?? entry.file ?? "?", error: err && err.message ? err.message : String(err) });
      }
    });
    writeManifest(dir, keep);
    if (keep.length === 0) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
    }
  }
  return { restored, failed };
}

/** 清空回收站（传 bucket 只清一个时间桶） */
export function purgeTrash(opts = {}) {
  const root = resolve(opts.root ?? DEFAULT_ROOT);
  const p = paths(root);
  let bytes = 0;
  let buckets = 0;
  const targets = opts.bucket ? [assertSafeName(opts.bucket, "回收站桶名")] : listDirs(p.trash);
  for (const bucket of targets) {
    const dir = join(p.trash, bucket);
    assertInside(dir, p.trash);
    if (!existsSync(dir)) continue;
    bytes += sizeOf(dir);
    rmSync(dir, { recursive: true, force: true });
    buckets += 1;
  }
  return { buckets, bytes };
}
