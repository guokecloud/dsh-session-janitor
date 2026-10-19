// 客户端半侧离线冒烟测试：不装 DSH、不开浏览器
// 1) 验证 factory 能被 __ModuleLoader__ 捕获、导出 name/inject/apply
// 2) 验证 apply() 注册的槽位（sidebar.panellist + main）正确
// 3) 用 stub react 真正执行一次 CleanerPanel()，检查渲染树里的行数/文本
import { pathToFileURL } from "node:url";

const FIXTURE = {
  root: "C:\\Users\\x\\.dsh",
  sessions: [
    { kind: "session", id: "session-aaaa-1111", project: "--D-proj-a--", size: 11907198, ageMs: 1000, live: true, title: "桃园", turns: 155, hasCache: true },
    { kind: "session", id: "session-bbbb-2222", project: "--D-proj-a--", size: 20480, ageMs: 5 * 86400000, live: false, title: "老会话甲", turns: 3, hasCache: true },
    { kind: "session", id: "session-cccc-3333", project: "--D-proj-b--", size: 1024, ageMs: 40 * 86400000, live: false, title: "老会话乙", turns: 1, hasCache: false }
  ],
  archives: [
    { kind: "archive", id: "session-old-1", file: "session_abc.json", project: "Claude", title: "归档一", size: 6992, ageMs: 20 * 86400000 },
    { kind: "archive", id: "session-old-2", file: "session_def.json", project: "workspace", title: "归档二", size: 4152, ageMs: 21 * 86400000 }
  ],
  trash: {
    entries: [
      { trashId: "20261018-092341:0", bucket: "20261018-092341", index: 0, kind: "session", id: "session-dead", project: "--D-proj-a--", bytes: 2048, at: 1792286000000, stillThere: false, from: "x" }
    ],
    bytes: 2048
  },
  totals: { sessionCount: 3, sessionBytes: 11928662, archiveCount: 2, archiveBytes: 11144, trashCount: 1, trashBytes: 2048, liveCount: 1 }
};

const problems = [];
const check = (cond, label) => {
  console.log((cond ? "  ✓ " : "  ✗ ") + label);
  if (!cond) problems.push(label);
};

let captured = null;
globalThis.window = { __ModuleLoader__: { load: (def) => { captured = def; } } };

let firstUseState = true;
const reactStub = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children };
  },
  useState(init) {
    if (firstUseState) {
      firstUseState = false;
      return [FIXTURE, () => {}];
    }
    return [typeof init === "function" ? init() : init, () => {}];
  },
  useEffect() {},
  useCallback(fn) {
    return fn;
  },
  useMemo(fn) {
    return fn();
  },
  Fragment: "Fragment"
};

await import(new URL("../lib/client.js", import.meta.url).href);
console.log("1) 入口注册");
check(captured !== null, "__ModuleLoader__.load 被调用");
check(captured && captured.id === "dsh-session-janitor", "模块 id = dsh-session-janitor");

const exportsObj = captured.factory((spec) => {
  if (spec === "react") return reactStub;
  throw new Error("客户端半侧 require 了非 seed 模块: " + spec);
});
console.log("2) 导出符号");
check(exportsObj.name === "dsh-session-janitor", "name 导出正确");
check(Array.isArray(exportsObj.inject) && exportsObj.inject.includes("slots"), "inject 含 slots");
check(typeof exportsObj.apply === "function", "apply 是函数");

const injectedOwners = [];
const registered = [];
const ctx = {
  slots: {
    inject(owner, fn) {
      injectedOwners.push(owner);
      return fn();
    },
    register(opts, comp) {
      registered.push({ opts, comp });
      return () => {};
    }
  }
};
exportsObj.apply(ctx);
console.log("3) 槽位注册");
check(injectedOwners.join(",") === "sidebar.panellist,main", "inject 顺序 = sidebar.panellist, main（实际 " + injectedOwners.join(",") + "）");
const icon = registered.find((r) => r.opts.name === "sidebar.panellist");
const panel = registered.find((r) => r.opts.name === "main");
check(!!icon && icon.opts.id === "session-cleaner", "侧边栏 id = session-cleaner");
check(!!panel && panel.opts.key === "session-cleaner", "main key 与侧边栏 id 同名");
check(!!icon && icon.opts.label === "会话清理", "侧边栏 label = 会话清理");

console.log("4) 图标渲染");
const iconTree = icon.comp();
const iconNode = iconTree.type(iconTree.props);
check(iconNode && iconNode.type === "span", "图标最终渲染成 span");
check(!(iconNode.props && iconNode.props.onClick), "图标不自绑 onClick（点击由 sidebar owner 负责）");

console.log("5) 面板整树渲染（stub hooks + 假数据）");
const tree = icon && panel.comp().type();
const cls = [];
const texts = [];
const walk = (node) => {
  if (node == null || typeof node === "boolean") return;
  if (Array.isArray(node)) {
    node.forEach(walk);
    return;
  }
  if (typeof node === "string" || typeof node === "number") {
    texts.push(String(node));
    return;
  }
  if (typeof node.type === "function") {
    // 子组件（Checkbox 等）继续展开
    walk(node.type(Object.assign({}, node.props, { children: node.children })));
    return;
  }
  const c = node.props && node.props.className;
  if (typeof c === "string") cls.push(c);
  (node.children || []).forEach(walk);
};
walk(tree);
const rowCount = cls.filter((c) => c === "dscc-row").length;
check(rowCount === 6, "行数 = 3 会话 + 2 归档 + 1 回收站（实际 " + rowCount + "）");
const joined = texts.join(" | ");
check(joined.includes("桃园"), "渲染出会话标题（桃园）");
check(joined.includes("老会话乙"), "渲染出老会话标题");
check(joined.includes("归档一"), "渲染出归档标题");
check(joined.includes("session-dead"), "渲染出回收站条目 id");
check(joined.includes("使用中"), "渲染出「使用中」标记");
check(joined.includes("11.4 MB") || joined.includes("11.3 MB"), "体积格式化（" + (joined.match(/\d+\.\d+ MB/) || ["未命中"])[0] + "）");
check(joined.includes("40 天前"), "相对时间格式化（40 天前）");
check(cls.filter((c) => c === "dscc-btn").length >= 10, "按钮渲染数量（" + cls.filter((c) => c === "dscc-btn").length + "）");
check(!cls.includes("undefined"), "无 undefined className");

console.log(problems.length ? "\n❌ 失败 " + problems.length + " 项" : "\n✅ 客户端半侧冒烟测试全部通过");
process.exit(problems.length ? 1 : 0);
