# 发布到插件市场 · 操作清单（老板做 3 步，其余我都备好了）

> 市场（awesome-dsh-plugin）**不收 npm 包、只收 GitHub 仓库**：
> 投稿 = 往 `awesome-dsh-plugin` 提一个 PR，加 **一个** 文件
> `data/plugins/<owner>__dsh-session-janitor.yml`（内容见本目录 `market-entry.yml`）。
> npm 发布是**可选**的（只影响市场显示下载量），条目里手写 `npm:` 字段会被 CI 拒。

---

## 第一步：建 GitHub 仓库并推代码（只有你能做 —— 本机没有任何 GitHub 凭据）

本机实测：没有 `gh`、`~/.git-credentials`、`GH_TOKEN`；`~/.ssh/id_rsa` 对 github.com 是
`Permission denied (publickey)`。所以推代码这一步需要你操作。

1. 在 GitHub 上新建仓库：**名字必须是 `dsh-session-janitor`**（市场按 `owner/repo` 收录，
   插件在 `cordis.patch.yml` 里的 `name:` 必须能被解析成安装后的包名，保持同名最稳）。
   公开（public）、**不要**勾 README/.gitignore/License（本地已经有了）。
2. 本目录已经 `git init` + 首次提交好了（作者 `dsh`）。推上去只需：

   ```sh
   cd /d D:\openclaw\workspace\smzt-login\dsh-session-janitor
   git remote add origin https://github.com/<你的用户名>/dsh-session-janitor.git
   git branch -M main
   git push -u origin main
   ```

   （推的时候会让你登录 GitHub / 填 PAT；也可以用 GitHub Desktop 直接「Add local repository」再 Publish。）
3. 给仓库加 topic：**`dsh-plugin`**（市场 CI 会查）。

## 第二步：等一天

市场 CI 要求「仓库创建**满 1 天**」——今天建的仓库今天提 PR 会被自动拒（不是针对内容）。
所以：**建好仓库 → 明天（10-20 之后）再提 PR**。

## 第三步：提 PR（一个文件）

1. Fork `https://github.com/awesome-dsh-plugin/awesome-dsh-plugin`。
2. 把本目录的 `market-entry.yml` 复制进去，改成
   `data/plugins/<owner>__dsh-session-janitor.yml`，并把里面两处 `<OWNER>` 换成你的用户名。
3. 提 PR，标题可以写：`Add dsh-session-janitor (session)`；
   正文一句话：`Lists and cleans DSH session records and archive caches, with a restorable recycle bin and an in-use guard.`
4. **只加这一个文件**，不要动别的条目、不要手改生成的 README（CI 会核对 README 能否重新生成）。

## 市场会核什么（我们已经满足的）

| 要求 | 我们的情况 |
|---|---|
| `package.json` 声明 `dsh.bundle` | ✅ `dsh.bundle.patch = ./cordis.patch.yml` |
| 仓库根有 `cordis.patch.yml` | ✅ 有，且 `id/name = dsh-session-janitor` |
| 真实可用代码（非占位） | ✅ `lib/store.js` + `lib/index.js` + 手写 `lib/client.js` + `test/` 冒烟 11 项 |
| 仓库创建满 1 天 | ⏳ 等你建仓库，**明天**再提 |
| 加 `dsh-plugin` topic | ⏳ 第一步做 |
| 描述属实、不带营销词 | ✅ 见 `market-entry.yml`（描述逐条对得上代码） |
| 一个 PR 最多 3 条 | ✅ 只提 1 条 |

## 截图（可选）

市场详情页支持 App Store 式截图：在仓库里放 `screenshots.json`（1~8 张、相对路径、不能跳出目录），
下次构建自动生效。需要的话把面板截图放到 `assets/` 再建这个文件即可（本次先不提交）。
