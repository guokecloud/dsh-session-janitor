# dsh-session-janitor · DSH 会话清理

给 DSH 用的会话记录清理工具：**列表 → 勾选 → 移入回收站 → 可恢复 → 确认后彻底清空**。
删除永不直接抹掉，先移进 `~/.dsh/session-trash/<时间戳>/`，所以手滑也能救回来。

## 两种用法

### 一、独立版（立刻可用，不需要重启 DSH）

双击本目录里的 **`启动会话清理.cmd`**，浏览器会打开 `http://127.0.0.1:8788/dsh-session-janitor/`。
关掉那个最小化的黑窗口即停止服务。端口被占用时可手动跑：

```
node standalone.mjs --port 8899 --open
```

### 二、DSH 插件版（推荐 · 已安装）

**2026-10-18 09:3x 已装进 desktop 档案**（`dsh.profile.bundles` 共 12 项，依赖 `link:` 指向本目录）。
**重启 DSH 后生效**：左侧边栏出现 🧹「会话清理」图标，点开就是完整界面（独立页面，不占会话）。
也可以直接访问 `http://127.0.0.1:<DSH GUI 端口>/dsh-session-janitor/`（由 DSH 自己的 web 服务提供，与 GUI 同源）。

重新安装 / 装到别的档案：

```
node install-plugin.mjs            # 演练：只打印将要做什么
node install-plugin.mjs --apply    # 真装（会先备份 profile 的 package.json）
```

卸载：把 `dsh-session-janitor` 从 profile `package.json` 的 `dsh.profile.bundles` 里删掉、
并执行 `pnpm remove dsh-session-janitor`（或直接用备份 `package.json.bak-<时间戳>` 覆盖回去），然后重启 DSH。

> 客户端半侧是**手写的 `lib/client.js`**（无构建步骤），走 `sidebar.panellist` + `main` 两个槽位；
> 宿主半侧 `lib/index.js` 注册同源 HTTP 路由。二者靠 `cordis.patch.yml` 里的宿主条目被发现。

## 界面能做什么

| 区块 | 操作 |
|---|---|
| 会话记录 | 勾选 → 移入回收站；「只选 30 天前」一键勾选老会话；`全选 / 清空选择` |
| 归档缓存 | 清理 `session_projcache_archive_manager_v2` 里的历史归档条目 |
| 回收站 | 勾选 → 恢复到原位置；`彻底清空回收站`（不可恢复） |
| 顶部 | `刷新`、`打开回收站文件夹`、`打开会话目录`、`强制` 开关 |

- **使用中保护**：会话的“最后活动时间”取 `session.v4.jsonl.zstd` 的 mtime，
  最近 **10 分钟**内被写过的会话标黄，默认**服务端拒绝删除**（勾「强制」才放行）。
- **同时清理列表缓存**：删会话时会把 `storages/session_projcache/sessions/<id>.json`
  一起移进回收站，恢复时一并还原，避免出现“缓存有、正文没”的孤儿条目。
- **安全**：只监听 `127.0.0.1`；每个请求都校验 `Host` 必须是本机回环、
  `Origin` 必须同源、`Sec-Fetch-Site` 不能是 `cross-site`，否则 403。
  所有路径都做白名单校验（禁止 `..` 与目录穿越）。

## 目录与接口

被测数据的默认根目录是 `~/.dsh`（可用环境变量 `DSCC_ROOT` 覆盖，测试用）：

```
sessions/<项目>/<会话>/session.v4.jsonl.zstd                       会话正文
storages/session_projcache/sessions/<sessionId>.json              标题 / cwd / 轮数
storages/session_projcache_archive_manager_v2/sessions/*.json      已裁剪归档
session-trash/<时间戳>/manifest.json                               本工具的回收站（含还原路径）
```

HTTP 接口（插件版挂在 DSH 端口，独立版在 8788）：

```
GET  /dsh-session-janitor/            网页界面
GET  /dsh-session-janitor/api/ping    存活探测 + 数据根目录
GET  /dsh-session-janitor/api/list    会话 / 归档 / 回收站清单
POST /dsh-session-janitor/api/trash   {items:[{kind:"session",project,id}|{kind:"archive",file}],force?}
POST /dsh-session-janitor/api/restore {ids:["<桶>:<序号>"]}
POST /dsh-session-janitor/api/purge   {bucket?}
POST /dsh-session-janitor/api/reveal  {what:"trash"|"sessions"}
```

## 开发 / 自测

```
node --check lib/store.js
node --check lib/index.js
```

`lib/store.js` 是纯文件系统逻辑（不依赖 DSH），用临时假目录即可全量回归；
`lib/index.js` 的路由可用假 `ctx` + 假 `req/res` 直接调 `apply(ctx)` 验证。

## 已知边界

- 插件版要 **重启 DSH** 才会挂上路由；独立版不需要。
- 「使用中」判定靠写入时间，不是文件锁：正在被写入的会话靠 10 分钟窗口 + 文件占用（rename 失败）双重保护。
- 只处理会话与归档缓存；**不动** `schedule.json`、`workspace.json`、用量账本等运行状态。

## 收录到插件市场（awesome-dsh-plugin）

本插件按市场规范投稿：**一个 YAML 条目文件**（`data/plugins/<owner>__dsh-session-janitor.yml`）
就是全部投稿内容，市场从 **GitHub 仓库**安装（npm 发布是可选的，只影响市场显示下载量）。

仓库侧要求（都已满足）：`package.json` 声明 `dsh.bundle`（`./cordis.patch.yml`）、仓库根有
`cordis.patch.yml`、仓库带 `dsh-plugin` topic、仓库创建满 1 天、代码真实可用。
投稿步骤见本目录 `PUSH_GUIDE.md`，条目内容见 `market-entry.yml`。

## 作者 / 许可

- 作者：**dsh**
- 许可：MIT（见 `LICENSE`）
