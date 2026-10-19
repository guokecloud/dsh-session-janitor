/**
 * 把 dsh-session-janitor 装进一个 DSH profile（默认 desktop）：
 *   1) 备份 profile 的 package.json
 *   2) pnpm add "link:<本目录>"        （node/pnpm 取自 DSH 运行时）
 *   3) 把包名追加进 dsh.profile.bundles
 *
 * ⚠️ 默认演练（dry-run），加 --apply 才真写。装完必须【重启 DSH】才生效。
 *
 *   node install-plugin.mjs                     # 演练：只打印将要做什么
 *   node install-plugin.mjs --apply             # 真装（桌面档案）
 *   node install-plugin.mjs --apply --profile other
 *   node install-plugin.mjs --apply --profile-dir D:\some\profile
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PKG_NAME = "dsh-session-janitor";
const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const apply = argv.includes("--apply");
const dshHome = resolve(argOf("--dsh-home", join(process.env.USERPROFILE ?? "", ".dsh")));
const profileName = argOf("--profile", "desktop");
const profileDir = resolve(argOf("--profile-dir", join(dshHome, "profiles", profileName)));
const pkgPath = join(profileDir, "package.json");
const runtime = join(dshHome, "dsh-runtimes", "dsh-primary-runtime", "dependencies");
const nodeBin = argOf("--node", join(runtime, "node", "bin", process.platform === "win32" ? "node.exe" : "node"));
const pnpmBin = argOf("--pnpm", join(runtime, "pnpm", "bin", "pnpm.mjs"));

const say = (msg) => console.log(msg);
const fail = (msg) => {
  console.error("[失败] " + msg);
  process.exit(1);
};

say(`插件目录：${HERE}`);
say(`目标 profile：${profileDir}`);
say(`node：${nodeBin}`);
say(`pnpm：${pnpmBin}`);
say(`模式：${apply ? "真装（--apply）" : "演练（不改任何文件，加 --apply 才真装）"}`);

if (!existsSync(join(HERE, "package.json"))) fail("本目录下没有 package.json，请在插件目录里运行");
if (!existsSync(pkgPath)) fail(`找不到 ${pkgPath}`);
if (!existsSync(nodeBin)) fail(`找不到 node：${nodeBin}（可用 --node 指定）`);
if (!existsSync(pnpmBin)) fail(`找不到 pnpm：${pnpmBin}（可用 --pnpm 指定）`);

let manifest;
try {
  manifest = JSON.parse(readFileSync(pkgPath, "utf8"));
} catch (err) {
  fail(`profile package.json 解析失败：${err.message}`);
}

const alreadyDep = Boolean(manifest.dependencies && manifest.dependencies[PKG_NAME]);
const bundles = manifest.dsh?.profile?.bundles;
const alreadyBundle = Array.isArray(bundles) && bundles.includes(PKG_NAME);

say(`当前依赖里有 ${PKG_NAME}：${alreadyDep ? "是" : "否"}`);
say(`当前 bundles 里有 ${PKG_NAME}：${alreadyBundle ? "是" : "否"}`);

if (!apply) {
  say("\n将要执行：");
  say(`  1) 备份 ${pkgPath} → package.json.bak-<时间戳>`);
  say(`  2) ${nodeBin} ${pnpmBin} add "link:${HERE}"   （cwd=${profileDir}）`);
  say(`  3) 把 "${PKG_NAME}" 追加到 dsh.profile.bundles 末尾`);
  say("\n演练结束。确认无误后在同样目录加 --apply 重跑。");
  process.exit(0);
}

const stamp = new Date()
  .toISOString()
  .replace(/[-:T]/g, "")
  .slice(0, 14);
const backup = `${pkgPath}.bak-${stamp}`;
copyFileSync(pkgPath, backup);
say(`\n[1/3] 已备份 → ${backup}`);

say(`[2/3] pnpm add link:${HERE} …`);
const res = spawnSync(nodeBin, [pnpmBin, "add", `link:${HERE}`], {
  cwd: profileDir,
  stdio: "inherit",
  env: { ...process.env, npm_config_yes: "true" }
});
if (res.status !== 0) fail(`pnpm add 失败（退出码 ${res.status}）。备份在 ${backup}，可手工回滚。`);

let next;
try {
  next = JSON.parse(readFileSync(pkgPath, "utf8"));
} catch (err) {
  fail(`pnpm 之后的 package.json 解析失败：${err.message}（备份：${backup}）`);
}
next.dsh = next.dsh ?? {};
next.dsh.profile = next.dsh.profile ?? {};
next.dsh.profile.bundles = Array.isArray(next.dsh.profile.bundles) ? next.dsh.profile.bundles : [];
if (!next.dsh.profile.bundles.includes(PKG_NAME)) next.dsh.profile.bundles.push(PKG_NAME);
writeFileSync(pkgPath, JSON.stringify(next, null, 2) + "\n", "utf8");
say(`[3/3] 已写入 bundles（共 ${next.dsh.profile.bundles.length} 项）`);

let verify;
try {
  verify = JSON.parse(readFileSync(pkgPath, "utf8"));
} catch (err) {
  fail(`写入后校验失败：${err.message}（用 ${backup} 回滚）`);
}
const okBundle = verify.dsh?.profile?.bundles?.includes(PKG_NAME);
const okDep = Boolean(verify.dependencies && verify.dependencies[PKG_NAME]);
say(`\n校验：依赖 ${okDep ? "✓" : "✗"} · bundles ${okBundle ? "✓" : "✗"}`);
if (!okDep || !okBundle) fail(`安装不完整（备份：${backup}）`);

say("\n✅ 装好了。下一步：**重启 DSH** 才会挂上清理页。");
say(`   重启后打开：http://127.0.0.1:<DSH GUI 端口>/dsh-session-janitor/`);
say(`   不重启也能用独立版：双击 ${join(HERE, "启动会话清理.cmd")}`);
say(`   回滚：把 ${backup} 覆盖回 ${pkgPath}，再重启 DSH。`);
