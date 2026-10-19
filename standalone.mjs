/**
 * dsh-session-janitor · 独立版（不需要 DSH 插件、不需要重启）
 *
 *   node standalone.mjs [--port 8788] [--open]
 *
 * 只监听 127.0.0.1，页面与插件版完全同一份代码（lib/index.js 的端点表）。
 * 重复启动时若端口已在本机被本工具占用，会直接打开浏览器后退出。
 */
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { endpointList, makeRequestHandler, ROUTES, VERSION } from "./lib/index.js";
import { DEFAULT_ROOT } from "./lib/store.js";

const argv = process.argv.slice(2);
const argOf = (flag, fallback) => {
  const i = argv.indexOf(flag);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const PORT = Number(argOf("--port", process.env.DSCC_PORT ?? "8788"));
const OPEN = argv.includes("--open");
const URL_PAGE = `http://127.0.0.1:${PORT}${ROUTES.page}`;

function openBrowser(url) {
  try {
    const child = spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

const endpoints = endpointList().map((e) => ({ ...e, guarded: makeRequestHandler(e.method, e.handler) }));

const server = createServer((req, res) => {
  let pathname = "/";
  try {
    pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
  } catch {
    /* 保持默认 */
  }
  const trimmed = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  const endpoint =
    endpoints.find((e) => (e.path === pathname || e.path === trimmed) && e.method === req.method) ??
    endpoints.find((e) => e.path === pathname || e.path === trimmed);
  if (!endpoint) {
    res.statusCode = 404;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ ok: false, error: "not found" }));
    return;
  }
  Promise.resolve(endpoint.guarded(req, res)).catch((err) => {
    try {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: err && err.message ? err.message : String(err) }));
    } catch {
      /* ignore */
    }
  });
});

server.on("error", async (err) => {
  if (err && err.code === "EADDRINUSE") {
    let mine = false;
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}${ROUTES.ping}`, { signal: AbortSignal.timeout(2000) });
      const j = await r.json();
      mine = j && j.ok === true;
    } catch {
      mine = false;
    }
    if (mine) {
      console.log(`[dsh-session-janitor] 端口 ${PORT} 上已经是本工具在跑，直接打开浏览器。`);
      if (OPEN) openBrowser(URL_PAGE);
      process.exit(0);
    }
    console.error(`[dsh-session-janitor] 端口 ${PORT} 被别的程序占用了，换一个：node standalone.mjs --port 8899 --open`);
    process.exit(1);
  }
  console.error("[dsh-session-janitor] 启动失败：", err && err.message ? err.message : String(err));
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[dsh-session-janitor] v${VERSION} 独立版已启动（只监听 127.0.0.1）`);
  console.log(`  清理页：${URL_PAGE}`);
  console.log(`  数据目录：${DEFAULT_ROOT}`);
  console.log("  关掉这个窗口（或 Ctrl+C）就停止服务。");
  if (OPEN) openBrowser(URL_PAGE);
});
