/**
 * dsh-session-janitor · 宿主侧插件
 *
 * 在 DSH 自带的本地 web 服务器上挂几个精确路由：
 *   GET  /dsh-session-janitor/            中文网页界面（列表/删除/恢复/清空）
 *   GET  /dsh-session-janitor/api/list     会话 + 归档 + 回收站清单
 *   POST /dsh-session-janitor/api/trash    移入回收站
 *   POST /dsh-session-janitor/api/restore  从回收站恢复
 *   POST /dsh-session-janitor/api/purge    清空回收站
 *   POST /dsh-session-janitor/api/reveal   在资源管理器里打开目录
 *   GET  /dsh-session-janitor/api/ping     存活探测
 *
 * 删除永远 = 移动进 ~/.dsh/session-trash/<时间戳>/（可恢复），不直接抹掉。
 */
import { spawn } from "node:child_process";
import { DEFAULT_ROOT, list, purgeTrash, restoreItems, trashItems } from "./store.js";

export const name = "dsh-session-janitor";

const BASE = "/dsh-session-janitor";
const ROUTES = {
  page: BASE + "/",
  pageBare: BASE,
  list: BASE + "/api/list",
  trash: BASE + "/api/trash",
  restore: BASE + "/api/restore",
  purge: BASE + "/api/purge",
  reveal: BASE + "/api/reveal",
  ping: BASE + "/api/ping"
};
const VERSION = "0.1.0";
/** 数据根目录，默认 ~/.dsh；设 DSCC_ROOT 可指向别处（测试/多档案用） */
const ROOT = process.env.DSCC_ROOT && process.env.DSCC_ROOT.trim().length > 0 ? process.env.DSCC_ROOT.trim() : DEFAULT_ROOT;

/* ---------------------------------------------------------------- 工具 */

function parseAuthority(authority) {
  try {
    return new URL(`http://${authority}`);
  } catch {
    return void 0;
  }
}

function isLoopbackHostname(hostname) {
  const h = hostname.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
}

function isIpLiteralHostname(hostname) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(":");
}

/** 只接受本机同源请求（与 DSH 其它插件一致的口径） */
function isTrustedRequest(req) {
  const host = req.headers.host;
  if (typeof host !== "string" || host.length === 0) return false;
  const hostUrl = parseAuthority(host);
  if (hostUrl === void 0) return false;
  const secFetchSite = req.headers["sec-fetch-site"];
  if (secFetchSite === "cross-site") return false;
  const origin = req.headers.origin;
  if (typeof origin === "string") {
    if (origin === "null") return false;
    try {
      if (new URL(origin).host !== hostUrl.host) return false;
    } catch {
      return false;
    }
  }
  const hostname = hostUrl.hostname.toLowerCase();
  return isLoopbackHostname(hostname) || isIpLiteralHostname(hostname);
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(body));
}

function sendHtml(res, html) {
  res.statusCode = 200;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(html);
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolvePromise, rejectPromise) => {
    let text = "";
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        rejectPromise(new Error("请求体过大"));
        req.destroy();
        return;
      }
      text += chunk.toString("utf8");
    });
    req.on("end", () => resolvePromise(text));
    req.on("error", (err) => rejectPromise(err));
  });
}

async function readJsonBody(req) {
  const text = await readBody(req);
  if (text.trim().length === 0) return {};
  const parsed = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("请求体必须是 JSON 对象");
  }
  return parsed;
}

function openFolder(dir) {
  try {
    const child = spawn("explorer.exe", [dir], { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/* ---------------------------------------------------------------- 页面 */

const EMPTY_HTML = (message) =>
  `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>DSH 会话清理</title>` +
  `<body style="font:15px/1.6 system-ui,'Microsoft YaHei',sans-serif;padding:40px;color:#333">` +
  `<h2>DSH 会话清理</h2><p>${message}</p></body></html>`;

function pageHtml() {
  return HTML_PAGE;
}

/* ---------------------------------------------------------------- 路由 */

function handleList(res) {
  const data = list({ root: ROOT });
  sendJson(res, 200, { ok: true, data });
}

async function handleTrash(req, res) {
  const body = await readJsonBody(req);
  const items = Array.isArray(body.items) ? body.items : [];
  if (items.length === 0) {
    sendJson(res, 400, { ok: false, error: "没有选中任何条目" });
    return;
  }
  if (items.length > 500) {
    sendJson(res, 400, { ok: false, error: "一次最多 500 条" });
    return;
  }
  const result = trashItems(items, { root: ROOT, force: body.force === true });
  sendJson(res, 200, { ok: true, data: result });
}

async function handleRestore(req, res) {
  const body = await readJsonBody(req);
  const ids = Array.isArray(body.ids) ? body.ids : [];
  if (ids.length === 0) {
    sendJson(res, 400, { ok: false, error: "没有选中任何回收站条目" });
    return;
  }
  const result = restoreItems(ids, { root: ROOT });
  sendJson(res, 200, { ok: true, data: result });
}

async function handlePurge(req, res) {
  const body = await readJsonBody(req);
  const result = purgeTrash({ root: ROOT, bucket: typeof body.bucket === "string" ? body.bucket : void 0 });
  sendJson(res, 200, { ok: true, data: result });
}

async function handleReveal(req, res) {
  const body = await readJsonBody(req);
  const what = body.what === "sessions" ? "sessions" : "trash";
  const target = what === "sessions" ? ROOT + "\\sessions" : ROOT + "\\session-trash";
  const opened = openFolder(target);
  sendJson(res, 200, { ok: true, data: { opened, target } });
}

/** 把「来源校验 + 方法校验 + 异常兜底」包在业务处理外面 */
export function makeRequestHandler(method, handler) {
  return async (req, res) => {
    try {
      if (!isTrustedRequest(req)) {
        sendJson(res, 403, { ok: false, error: "forbidden" });
        return;
      }
      if (req.method !== method) {
        sendJson(res, 405, { ok: false, error: "method not allowed" });
        return;
      }
      await handler(req, res);
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      try {
        sendJson(res, 500, { ok: false, error: message });
      } catch {
        /* 响应可能已经开始 */
      }
    }
  };
}

/** 全部端点（独立版与插件版共用同一份定义） */
export function endpointList() {
  return [
    { method: "GET", path: ROUTES.page, handler: async (req, res) => sendHtml(res, HTML_PAGE) },
    { method: "GET", path: ROUTES.pageBare, handler: async (req, res) => sendHtml(res, HTML_PAGE) },
    {
      method: "GET",
      path: ROUTES.ping,
      handler: async (req, res) => sendJson(res, 200, { ok: true, data: { version: VERSION, root: ROOT } })
    },
    { method: "GET", path: ROUTES.list, handler: async (req, res) => handleList(res) },
    { method: "POST", path: ROUTES.trash, handler: handleTrash },
    { method: "POST", path: ROUTES.restore, handler: handleRestore },
    { method: "POST", path: ROUTES.purge, handler: handlePurge },
    { method: "POST", path: ROUTES.reveal, handler: handleReveal }
  ];
}

/* ---------------------------------------------------------------- 挂载 */

export function apply(ctx) {
  ctx.inject(["webServer"], (webServerCtx) => {
    const webServer = webServerCtx.webServer;
    if (!webServer || typeof webServer.register !== "function") {
      ctx.logger?.warn?.("[dsh-session-janitor] 找不到 webServer.register，插件未挂载");
      return;
    }
    for (const endpoint of endpointList()) {
      const label = `dsh-session-janitor: ${endpoint.method} ${endpoint.path}`;
      ctx.effect(
        () =>
          webServer.register(
            { kind: "exact", path: endpoint.path, handler: makeRequestHandler(endpoint.method, endpoint.handler) },
            label
          ),
        label
      );
    }
    ctx.logger?.info?.(`[dsh-session-janitor] 已挂载：${ROUTES.page}（数据根目录 ${ROOT}）`);
  });
}

/* ---------------------------------------------------------------- HTML */

const HTML_PAGE = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DSH 会话清理</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 20px 24px 60px; font: 14px/1.6 system-ui, "Microsoft YaHei", "Segoe UI", sans-serif; background: #f6f7f9; color: #1f2328; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 22px 0 8px; }
  .sub { color: #6b7280; font-size: 12.5px; }
  .bar { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin: 12px 0; }
  .card { background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; margin-top: 10px; box-shadow: 0 1px 2px rgba(16,24,40,.04); }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #eef0f3; vertical-align: top; }
  th { font-weight: 600; color: #4b5563; background: #fafbfc; position: sticky; top: 0; }
  tr.live td { background: #fff8e6; }
  .mono { font-family: ui-monospace, Consolas, monospace; font-size: 12px; color: #4b5563; word-break: break-all; }
  .tag { display: inline-block; padding: 1px 6px; border-radius: 6px; font-size: 11.5px; }
  .tag.live { background: #fde68a; color: #7c4a03; }
  .tag.ok { background: #dcfce7; color: #166534; }
  .tag.warn { background: #fee2e2; color: #991b1b; }
  button { font: inherit; padding: 6px 12px; border-radius: 8px; border: 1px solid #d0d7de; background: #fff; cursor: pointer; }
  button:hover { background: #f3f4f6; }
  button.primary { background: #d94f4f; border-color: #c34141; color: #fff; }
  button.primary:hover { background: #c34141; }
  button.ghost { border-color: transparent; background: transparent; color: #2563eb; padding: 4px 6px; }
  .msg { margin-top: 10px; padding: 10px 12px; border-radius: 8px; font-size: 13px; white-space: pre-wrap; display: none; }
  .msg.show { display: block; }
  .msg.ok { background: #ecfdf5; border: 1px solid #a7f3d0; color: #065f46; }
  .msg.err { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
  .size { text-align: right; white-space: nowrap; }
  .empty { color: #9ca3af; padding: 10px 4px; }
  .scroll { max-height: 52vh; overflow: auto; border: 1px solid #eef0f3; border-radius: 8px; }
  label.chk { display: inline-flex; gap: 6px; align-items: center; cursor: pointer; }
  code { background: #f3f4f6; padding: 1px 5px; border-radius: 5px; font-size: 12px; }
</style>
</head>
<body>
<h1>DSH 会话清理</h1>
<div class="sub" id="rootInfo">正在读取…</div>

<div class="bar">
  <button onclick="load()">刷新</button>
  <button onclick="reveal('trash')">打开回收站文件夹</button>
  <button onclick="reveal('sessions')">打开会话目录</button>
  <label class="chk"><input type="checkbox" id="force"> 强制（允许删除 10 分钟内仍在写入的会话）</label>
</div>

<div class="card">
  <div class="bar" style="margin:0 0 8px">
    <strong>会话记录</strong>
    <span class="sub" id="sessStat"></span>
    <span style="flex:1"></span>
    <button onclick="selectAll('sess', true)">全选</button>
    <button onclick="selectAll('sess', false)">清空选择</button>
    <button onclick="selectOlder('sess', 30)">只选 30 天前</button>
    <button class="primary" onclick="doTrash()">移入回收站（所选）</button>
  </div>
  <div class="scroll"><table>
    <thead><tr><th style="width:34px"></th><th style="width:210px">项目</th><th>标题 / 会话 ID</th><th style="width:90px" class="size">大小</th><th style="width:150px">最后活动</th><th style="width:96px">状态</th></tr></thead>
    <tbody id="sessBody"><tr><td colspan="6" class="empty">读取中…</td></tr></tbody>
  </table></div>
</div>

<div class="card">
  <div class="bar" style="margin:0 0 8px">
    <strong>归档缓存</strong>
    <span class="sub" id="archStat"></span>
    <span style="flex:1"></span>
    <button onclick="selectAll('arch', true)">全选</button>
    <button onclick="selectAll('arch', false)">清空选择</button>
    <button class="primary" onclick="doTrash()">移入回收站（所选）</button>
  </div>
  <div class="scroll" style="max-height:32vh"><table>
    <thead><tr><th style="width:34px"></th><th>归档文件</th><th style="width:210px">来源目录</th><th style="width:90px" class="size">大小</th><th style="width:150px">时间</th></tr></thead>
    <tbody id="archBody"><tr><td colspan="5" class="empty">读取中…</td></tr></tbody>
  </table></div>
</div>

<div class="card">
  <div class="bar" style="margin:0 0 8px">
    <strong>回收站</strong>
    <span class="sub" id="trashStat"></span>
    <span style="flex:1"></span>
    <button onclick="selectAll('trash', true)">全选</button>
    <button onclick="selectAll('trash', false)">清空选择</button>
    <button onclick="doRestore()">恢复所选</button>
    <button class="primary" onclick="doPurge()">彻底清空回收站</button>
  </div>
  <div class="scroll" style="max-height:32vh"><table>
    <thead><tr><th style="width:34px"></th><th>类型 / 名称</th><th style="width:210px">项目</th><th style="width:90px" class="size">大小</th><th style="width:150px">删除时间</th></tr></thead>
    <tbody id="trashBody"><tr><td colspan="5" class="empty">读取中…</td></tr></tbody>
  </table></div>
</div>

<div class="msg" id="msg"></div>

<script>
var API = "/dsh-session-janitor/api/";
var DATA = null;
var SELECTED = { sess: {}, arch: {}, trash: {} };

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}
function fmtSize(n) {
  n = Number(n || 0);
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  if (n < 1073741824) return (n / 1048576).toFixed(2) + " MB";
  return (n / 1073741824).toFixed(2) + " GB";
}
function fmtAgo(ms) {
  if (ms == null) return "-";
  var s = Math.floor(ms / 1000);
  if (s < 60) return s + " 秒前";
  var m = Math.floor(s / 60);
  if (m < 60) return m + " 分钟前";
  var h = Math.floor(m / 60);
  if (h < 24) return h + " 小时前";
  var d = Math.floor(h / 24);
  if (d < 60) return d + " 天前";
  return new Date(Date.now() - ms).toLocaleDateString();
}
function fmtTime(ms) {
  if (!ms) return "-";
  var d = new Date(ms);
  var p = function (x) { return String(x).length < 2 ? "0" + x : String(x); };
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
}
function show(kind, text) {
  var el = document.getElementById("msg");
  el.className = "msg show " + kind;
  el.textContent = text;
}
function hide() { document.getElementById("msg").className = "msg"; }

function load() {
  hide();
  fetch(API + "list").then(function (r) { return r.json(); }).then(function (j) {
    if (!j.ok) throw new Error(j.error || "读取失败");
    DATA = j.data;
    render();
  }).catch(function (e) { show("err", "读取失败：" + e.message); });
}

function render() {
  var d = DATA, t = d.totals;
  document.getElementById("rootInfo").textContent =
    "数据目录 " + d.root + " · 共 " + t.sessionCount + " 个会话 / " + fmtSize(t.sessionBytes) +
    " · 归档 " + t.archiveCount + " 条 / " + fmtSize(t.archiveBytes) +
    " · 回收站 " + t.trashCount + " 项 / " + fmtSize(t.trashBytes) +
    " · 判定“正在使用”的窗口：10 分钟";
  document.getElementById("sessStat").textContent = "(" + t.sessionCount + " 个 / " + fmtSize(t.sessionBytes) + ")";
  document.getElementById("archStat").textContent = "(" + t.archiveCount + " 条 / " + fmtSize(t.archiveBytes) + ")";
  document.getElementById("trashStat").textContent = "(" + t.trashCount + " 项 / " + fmtSize(t.trashBytes) + ")";

  var body = document.getElementById("sessBody");
  if (d.sessions.length === 0) {
    body.innerHTML = '<tr><td colspan="6" class="empty">没有会话</td></tr>';
  } else {
    body.innerHTML = d.sessions.map(function (s) {
      var key = s.project + "/" + s.id;
      var checked = SELECTED.sess[key] ? " checked" : "";
      var badge = s.live
        ? '<span class="tag live">使用中</span>'
        : '<span class="tag ok">可删</span>';
      return '<tr class="' + (s.live ? "live" : "") + '">' +
        '<td><input type="checkbox" data-group="sess" data-key="' + esc(key) + '"' + checked + ' onchange="toggle(this)"></td>' +
        '<td class="mono">' + esc(s.project) + '</td>' +
        '<td>' + (s.title ? esc(s.title) : '<span class="sub">（无标题）</span>') +
          '<div class="mono">' + esc(s.id) + (s.turns != null ? " · " + s.turns + " 轮" : "") +
          (s.cwd ? '<br>' + esc(s.cwd) : "") + '</div></td>' +
        '<td class="size">' + fmtSize(s.size) + '</td>' +
        '<td>' + fmtAgo(s.ageMs) + '<div class="sub">' + fmtTime(s.mtime) + '</div></td>' +
        '<td>' + badge + '</td></tr>';
    }).join("");
  }

  var ab = document.getElementById("archBody");
  if (d.archives.length === 0) {
    ab.innerHTML = '<tr><td colspan="5" class="empty">没有归档条目</td></tr>';
  } else {
    ab.innerHTML = d.archives.map(function (a) {
      var checked = SELECTED.arch[a.file] ? " checked" : "";
      return '<tr><td><input type="checkbox" data-group="arch" data-key="' + esc(a.file) + '"' + checked + ' onchange="toggle(this)"></td>' +
        '<td class="mono">' + esc(a.file) + '<div class="sub mono">' + esc(a.id) + '</div></td>' +
        '<td class="mono">' + esc(a.project || (a.cwd || "-")) + '</td>' +
        '<td class="size">' + fmtSize(a.size) + '</td>' +
        '<td>' + fmtAgo(a.ageMs) + '</td></tr>';
    }).join("");
  }

  var tb = document.getElementById("trashBody");
  if (d.trash.entries.length === 0) {
    tb.innerHTML = '<tr><td colspan="5" class="empty">回收站是空的</td></tr>';
  } else {
    tb.innerHTML = d.trash.entries.map(function (e) {
      var checked = SELECTED.trash[e.trashId] ? " checked" : "";
      return '<tr><td><input type="checkbox" data-group="trash" data-key="' + esc(e.trashId) + '"' + checked + ' onchange="toggle(this)"></td>' +
        '<td>' + (e.kind === "session" ? "会话" : "归档") + ' <span class="mono">' + esc(e.id) + '</span>' +
          (e.stillThere ? "" : ' <span class="tag warn">内容已不在</span>') + '</td>' +
        '<td class="mono">' + esc(e.project || "-") + '</td>' +
        '<td class="size">' + fmtSize(e.bytes) + '</td>' +
        '<td>' + fmtTime(e.at) + '</td></tr>';
    }).join("");
  }
}

function toggle(el) {
  var g = el.getAttribute("data-group"), k = el.getAttribute("data-key");
  if (el.checked) SELECTED[g][k] = 1; else delete SELECTED[g][k];
}
function selectAll(group, on) {
  var boxes = document.querySelectorAll('input[data-group="' + group + '"]');
  SELECTED[group] = {};
  for (var i = 0; i < boxes.length; i++) {
    boxes[i].checked = on;
    if (on) SELECTED[group][boxes[i].getAttribute("data-key")] = 1;
  }
}
function selectOlder(group, days) {
  var lim = days * 86400000;
  SELECTED[group] = {};
  var boxes = document.querySelectorAll('input[data-group="' + group + '"]');
  var map = {};
  (DATA.sessions || []).forEach(function (s) { map[s.project + "/" + s.id] = s.ageMs; });
  for (var i = 0; i < boxes.length; i++) {
    var k = boxes[i].getAttribute("data-key");
    var age = map[k];
    var on = age != null && age > lim;
    boxes[i].checked = on;
    if (on) SELECTED[group][k] = 1;
  }
}
function keysOf(group) { return Object.keys(SELECTED[group]); }

function post(path, body) {
  return fetch(API + path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {})
  }).then(function (r) { return r.json(); });
}

function doTrash() {
  var items = [];
  keysOf("sess").forEach(function (k) {
    var i = k.indexOf("/");
    items.push({ kind: "session", project: k.slice(0, i), id: k.slice(i + 1) });
  });
  keysOf("arch").forEach(function (f) { items.push({ kind: "archive", file: f }); });
  if (items.length === 0) { show("err", "先勾选要删除的条目"); return; }
  var force = document.getElementById("force").checked;
  var live = (DATA.sessions || []).filter(function (s) {
    return s.live && SELECTED.sess[s.project + "/" + s.id];
  }).length;
  var text = "把 " + items.length + " 项移入回收站？\n（不会真正删除，可在下方回收站里恢复）";
  if (live > 0 && !force) text += "\n\n其中 " + live + " 个会话仍在写入，会被服务器拒绝。";
  if (!window.confirm(text)) return;
  post("trash", { items: items, force: force }).then(function (j) {
    if (!j.ok) throw new Error(j.error || "失败");
    var m = j.data.moved.length, f = j.data.failed.length;
    var lines = ["已移入回收站：" + m + " 项"];
    if (f > 0) lines.push("未删除：" + f + " 项");
    (j.data.failed || []).forEach(function (x) { lines.push("  ✗ " + (x.kind === "session" ? x.id : x.id) + "：" + x.error); });
    SELECTED = { sess: {}, arch: {}, trash: {} };
    load();
    show(f > 0 ? "err" : "ok", lines.join("\n"));
  }).catch(function (e) { show("err", "失败：" + e.message); });
}

function doRestore() {
  var ids = keysOf("trash");
  if (ids.length === 0) { show("err", "先勾选要恢复的条目"); return; }
  if (!window.confirm("把 " + ids.length + " 项恢复到原位置？")) return;
  post("restore", { ids: ids }).then(function (j) {
    if (!j.ok) throw new Error(j.error || "失败");
    var lines = ["已恢复：" + j.data.restored.length + " 项"];
    (j.data.failed || []).forEach(function (x) { lines.push("  ✗ " + x.id + "：" + x.error); });
    SELECTED = { sess: {}, arch: {}, trash: {} };
    load();
    show(j.data.failed.length > 0 ? "err" : "ok", lines.join("\n"));
  }).catch(function (e) { show("err", "失败：" + e.message); });
}

function doPurge() {
  if (!window.confirm("彻底清空回收站？此操作不可恢复！")) return;
  post("purge", {}).then(function (j) {
    if (!j.ok) throw new Error(j.error || "失败");
    load();
    show("ok", "回收站已清空：" + j.data.buckets + " 个批次 / " + fmtSize(j.data.bytes));
  }).catch(function (e) { show("err", "失败：" + e.message); });
}

function reveal(what) {
  post("reveal", { what: what }).then(function (j) {
    if (!j.ok) throw new Error(j.error || "失败");
    show("ok", "已尝试打开：" + j.data.target + (j.data.opened ? "" : "（打开失败，可手动访问）"));
  }).catch(function (e) { show("err", e.message); });
}

load();
</script>
</body>
</html>`;

export { ROUTES, VERSION, EMPTY_HTML };
