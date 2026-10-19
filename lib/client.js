// dsh-session-janitor · 客户端半侧
// 手写 CJS factory，无构建步骤：DSH 会把它当 <script src="/plugins/dsh-session-janitor/client.js"> 加载。
// 只有平台 seed 表里的模块可以 require（react / react-dom / cordis / zod / ui-slots / ui-primitives / ui-dockkit）。
// 注意：本包禁止 require 任何 @deepseek-ai/dsh-client-ui-* 客户端包（平台约定），控件全部自绘。
window.__ModuleLoader__.load({
  id: "dsh-session-janitor",
  factory(require) {
    var module = { exports: {} };
    var exports = module.exports;
    "use strict";

    var React = require("react");
    var h = React.createElement;

    var BASE = "/dsh-session-janitor";
    var PANEL_ID = "session-cleaner";
    var DAY = 86400000;

    /* ---------------- 与宿主通信 ---------------- */

    function request(path, init) {
      var opts = Object.assign({ headers: { accept: "application/json" } }, init || {});
      return fetch(BASE + path, opts).then(function (res) {
        return res.text().then(function (text) {
          var body = null;
          try {
            body = text ? JSON.parse(text) : null;
          } catch (err) {
            body = null;
          }
          if (!res.ok || !body || body.ok !== true) {
            var e = new Error((body && body.error) || "HTTP " + res.status);
            e.payload = body;
            throw e;
          }
          return body.data;
        });
      });
    }
    function apiList() {
      return request("/api/list", { method: "GET" });
    }
    function apiPost(path, body) {
      return request(path, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body || {})
      });
    }

    /* ---------------- 小工具 ---------------- */

    function fmtSize(n) {
      var v = Number(n) || 0;
      if (v < 1024) return v + " B";
      if (v < 1024 * 1024) return (v / 1024).toFixed(1) + " KB";
      if (v < 1024 * 1024 * 1024) return (v / 1048576).toFixed(1) + " MB";
      return (v / 1073741824).toFixed(2) + " GB";
    }
    function fmtAge(ms) {
      var v = Number(ms) || 0;
      if (v < 60000) return "刚刚";
      if (v < 3600000) return Math.floor(v / 60000) + " 分钟前";
      if (v < DAY) return Math.floor(v / 3600000) + " 小时前";
      return Math.floor(v / DAY) + " 天前";
    }
    function fmtTime(ms) {
      var t = Number(ms);
      if (!t) return "—";
      var d = new Date(t);
      var p = function (x) {
        return (x < 10 ? "0" : "") + x;
      };
      return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
    }
    function shorten(s, n) {
      var t = String(s == null ? "" : s).replace(/\s+/g, " ").trim();
      return t.length > n ? t.slice(0, n) + "…" : t;
    }
    function byNewest(a, b) {
      return (Number(a.ageMs) || 0) - (Number(b.ageMs) || 0);
    }

    var CSS = [
      ".dscc-root{display:flex;flex-direction:column;gap:10px;padding:14px 16px;box-sizing:border-box;overflow:hidden;",
      "height:100%;height:100dvh;max-height:100%;max-height:100dvh;",
      "color:var(--dsw-alias-label-primary,inherit);font-size:13px}",
      ".dscc-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}",
      ".dscc-title{font-size:15px;font-weight:600}",
      ".dscc-sub{color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:12px}",
      ".dscc-cards{display:flex;gap:10px;flex-wrap:wrap}",
      ".dscc-card{border:1px solid var(--dsw-alias-border-l2,#3a3a3a);border-radius:8px;padding:6px 10px;min-width:96px;",
      "background:var(--dsw-alias-bg-layer-2,transparent)}",
      ".dscc-card b{display:block;font-size:15px;font-weight:600}",
      ".dscc-card span{font-size:11px;color:var(--dsw-alias-label-tertiary,#8a8a8a)}",
      ".dscc-bar{display:flex;align-items:center;gap:8px;flex-wrap:wrap}",
      ".dscc-btn{border:1px solid var(--dsw-alias-border-l2,#3a3a3a);background:transparent;color:inherit;border-radius:6px;",
      "padding:4px 10px;font-size:12px;cursor:pointer}",
      ".dscc-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.15))}",
      ".dscc-btn:disabled{opacity:.45;cursor:default}",
      ".dscc-btn.danger{border-color:var(--dsw-alias-border-danger,#a33);color:var(--dsw-alias-label-danger,#e66)}",
      // 列表区必须能滚：flex 撑满 + min-height:0（父级高度确定时生效）、max-height 兜底（父级高度不确定时也能滚）
      ".dscc-body{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;",
      "max-height:calc(100vh - 260px);display:flex;flex-direction:column;gap:14px;padding-right:6px}",
      ".dscc-sec{border:1px solid var(--dsw-alias-border-l2,#3a3a3a);border-radius:10px;overflow:hidden}",
      ".dscc-sec-h{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08));",
      "border-bottom:1px solid var(--dsw-alias-border-l2,#3a3a3a);font-weight:600;font-size:12.5px;",
      "position:sticky;top:0;z-index:2;backdrop-filter:blur(2px)}",
      ".dscc-sec-h .dscc-grow{flex:1}",
      // 每个区自己的滚动容器：即使外层布局不给固定高度（宿主 main 区被裁），三区也能各自滚、都看得到
      ".dscc-rows{overflow-y:auto;overscroll-behavior:contain;min-height:0}",
      ".dscc-rows.rows-sessions{max-height:min(26vh,200px)}",
      ".dscc-rows.rows-archives{max-height:min(15vh,120px)}",
      ".dscc-rows.rows-trash{max-height:min(13vh,110px)}",
      ".dscc-row{display:flex;align-items:center;gap:10px;padding:6px 12px;border-bottom:1px dashed var(--dsw-alias-border-l3,rgba(127,127,127,.2))}",
      ".dscc-row:last-child{border-bottom:none}",
      ".dscc-row:hover{background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.07))}",
      ".dscc-row .dscc-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
      ".dscc-row .dscc-meta{color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:11.5px;white-space:nowrap}",
      ".dscc-tag{font-size:10.5px;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2,#3a3a3a);",
      "color:var(--dsw-alias-label-tertiary,#8a8a8a)}",
      ".dscc-tag.live{color:#e0a020;border-color:#e0a02066}",
      ".dscc-msg{min-height:18px;font-size:12px;color:var(--dsw-alias-label-secondary,inherit);white-space:pre-wrap}",
      ".dscc-input{border:1px solid var(--dsw-alias-border-l2,#3a3a3a);background:transparent;color:inherit;border-radius:6px;",
      "padding:3px 8px;font-size:12px;min-width:150px}",
      ".dscc-input:focus{outline:1px solid var(--dsw-alias-border-l1,#5a5a5a)}",
      ".dscc-input.purge{min-width:104px;width:104px}",
      ".dscc-empty{padding:10px 12px;color:var(--dsw-alias-label-tertiary,#8a8a8a);font-size:12px}"
    ].join("");

    function useStyleOnce() {
      React.useEffect(function () {
        if (document.getElementById("dscc-style")) return undefined;
        var el = document.createElement("style");
        el.id = "dscc-style";
        el.textContent = CSS;
        document.head.appendChild(el);
        return function () {
          var cur = document.getElementById("dscc-style");
          if (cur) cur.remove();
        };
      }, []);
    }

    /* ---------------- 面板 ---------------- */

    function Checkbox(props) {
      return h("input", {
        type: "checkbox",
        checked: !!props.checked,
        disabled: !!props.disabled,
        onChange: props.onChange,
        style: { cursor: props.disabled ? "default" : "pointer", flex: "0 0 auto" }
      });
    }

    function CleanerPanel() {
      useStyleOnce();
      var st = React.useState(null);
      var data = st[0];
      var setData = st[1];
      var sb = React.useState(false);
      var busy = sb[0];
      var setBusy = sb[1];
      var sm = React.useState("");
      var msg = sm[0];
      var setMsg = sm[1];
      var sf = React.useState(false);
      var force = sf[0];
      var setForce = sf[1];
      var ss = React.useState({});
      var sel = ss[0];
      var setSel = ss[1];
      var sq = React.useState("");
      var q = sq[0];
      var setQ = sq[1];
      var so = React.useState("time");
      var sortBy = so[0];
      var setSortBy = so[1];
      var sp = React.useState("");
      var purgeWord = sp[0];
      var setPurgeWord = sp[1];

      var load = React.useCallback(function () {
        return apiList()
          .then(function (d) {
            setData(d);
            return d;
          })
          .catch(function (e) {
            setMsg("读取失败：" + String((e && e.message) || e));
            return null;
          });
      }, []);

      React.useEffect(function () {
        load();
      }, [load]);

      var run = React.useCallback(
        function (label, fn) {
          setBusy(true);
          setMsg(label + "…");
          Promise.resolve()
            .then(fn)
            .then(function (note) {
              setMsg(label + "完成" + (note ? " · " + note : ""));
              return load();
            })
            .catch(function (e) {
              setMsg(label + "失败：" + String((e && e.message) || e));
            })
            .then(function () {
              setBusy(false);
            });
        },
        [load]
      );

      var toggle = function (key, on) {
        setSel(function (prev) {
          var next = Object.assign({}, prev);
          if (on) next[key] = true;
          else delete next[key];
          return next;
        });
      };
      var patch = function (keys, on) {
        setSel(function (prev) {
          var next = Object.assign({}, prev);
          keys.forEach(function (k) {
            if (on) next[k] = true;
            else delete next[k];
          });
          return next;
        });
      };

      if (!data) {
        return h(
          "div",
          { className: "dscc-root" },
          h("div", { className: "dscc-head" }, h("div", { className: "dscc-title" }, "会话清理")),
          h("div", { className: "dscc-msg" }, msg || "读取中…")
        );
      }

      var allSessions = (data.sessions || []).slice();
      var allArchives = (data.archives || []).slice();
      var trash = (data.trash && data.trash.entries) || [];
      var totals = data.totals || {};

      // 搜索：标题 / 项目 / id / 文件名
      var query = String(q || "").trim().toLowerCase();
      var match = function (hay) {
        return !query || String(hay == null ? "" : hay).toLowerCase().indexOf(query) !== -1;
      };
      var sortList = function (list) {
        var out = list.slice();
        if (sortBy === "size") {
          out.sort(function (a, b) { return (Number(b.size) || 0) - (Number(a.size) || 0); });
        } else if (sortBy === "turns") {
          out.sort(function (a, b) { return (Number(b.turns) || 0) - (Number(a.turns) || 0); });
        } else if (sortBy === "old") {
          out.sort(function (a, b) { return (Number(b.ageMs) || 0) - (Number(a.ageMs) || 0); });
        } else {
          out.sort(byNewest);
        }
        return out;
      };
      var sessions = sortList(allSessions.filter(function (s) {
        return match(s.title) || match(s.project) || match(s.id);
      }));
      var archives = sortList(allArchives.filter(function (a) {
        return match(a.title) || match(a.project) || match(a.file);
      }));

      var cleanable = allSessions.filter(function (s) { return !s.live; });
      var cleanableBytes = cleanable.reduce(function (n, s) { return n + (Number(s.size) || 0); }, 0);
      var selCount = Object.keys(sel).length;
      var selBytes = 0;
      allSessions.forEach(function (s) { if (sel["s:" + s.project + "/" + s.id]) selBytes += Number(s.size) || 0; });
      allArchives.forEach(function (a) { if (sel["a:" + a.file]) selBytes += Number(a.size) || 0; });
      trash.forEach(function (t) { if (sel["t:" + t.trashId]) selBytes += Number(t.bytes) || 0; });

      var sKey = function (s) {
        return "s:" + s.project + "/" + s.id;
      };
      var aKey = function (a) {
        return "a:" + a.file;
      };
      var tKey = function (t) {
        return "t:" + t.trashId;
      };

      // 注意：这里用 allSessions/allArchives —— 搜索把条目藏起来时，已勾选的仍然算数
      var pickSessions = function () {
        return allSessions.filter(function (s) {
          return sel[sKey(s)];
        });
      };
      var pickArchives = function () {
        return allArchives.filter(function (a) {
          return sel[aKey(a)];
        });
      };
      var pickTrash = function () {
        return trash.filter(function (t) {
          return sel[tKey(t)];
        });
      };

      var doTrash = function (items, what) {
        if (!items.length) {
          setMsg("没有选中要删除的" + what);
          return;
        }
        var needed = items.filter(function (it) {
          if (it.kind !== "session") return false;
          var hit = sessions.filter(function (s) {
            return s.id === it.id && s.project === it.project;
          })[0];
          return hit && hit.live;
        }).length;
        if (needed && !force) {
          setMsg("选中里有 " + needed + " 个正在使用的会话；确认要删就勾上「强制」，否则请取消勾选");
          return;
        }
        var warn = needed ? "\n⚠️ 其中 " + needed + " 个正在使用，强制删除可能导致正在进行的会话异常。" : "";
        if (!window.confirm("把选中的 " + items.length + " 个" + what + "移入回收站？" + warn + "\n（先移入回收站，之后可随时恢复）")) return;
        run("移入回收站", function () {
          return apiPost("/api/trash", { items: items, force: force }).then(function (out) {
            var moved = (out.moved || []).length;
            var failed = out.failed || [];
            if (!failed.length) return moved + " 项已移入回收站";
            return (
              moved +
              " 项成功，" +
              failed.length +
              " 项被拒绝（" +
              failed
                .map(function (f) {
                  return String(f.id || f.file || "?") + "：" + String(f.error || "");
                })
                .join("；") +
              "）"
            );
          });
        });
      };

      var doRestore = function () {
        var items = pickTrash();
        if (!items.length) {
          setMsg("没有选中要恢复的条目");
          return;
        }
        run("恢复", function () {
          return apiPost("/api/restore", {
            ids: items.map(function (t) {
              return t.trashId;
            })
          }).then(function (out) {
            var ok = (out.restored || []).length;
            var failed = out.failed || [];
            return failed.length ? ok + " 项已恢复，" + failed.length + " 项失败" : ok + " 项已恢复";
          });
        });
      };

      var doPurge = function () {
        if (!trash.length) {
          setMsg("回收站已经是空的");
          return;
        }
        if (!window.confirm("彻底清空回收站？\n这一步不可恢复（共 " + trash.length + " 项 / " + fmtSize(totals.trashBytes) + "）。")) return;
        run("清空回收站", function () {
          return apiPost("/api/purge", {}).then(function (out) {
            return "已删除 " + (out.buckets || 0) + " 个批次 / " + fmtSize(out.bytes);
          });
        });
      };

      var reveal = function (what) {
        run("打开文件夹", function () {
          return apiPost("/api/reveal", { what: what }).then(function () {
            return what === "trash" ? "已打开回收站目录" : "已打开会话目录";
          });
        });
      };

      var card = function (label, value) {
        return h("div", { className: "dscc-card", key: label }, h("b", null, value), h("span", null, label));
      };

      var header = h(
        "div",
        { className: "dscc-head" },
        h("div", { className: "dscc-title" }, "会话清理"),
        h("div", { className: "dscc-sub" }, data.root || ""),
        h("div", { className: "dscc-sub", style: { marginLeft: "auto" } }, "v0.2.4 · 三区各自可滚")
      );

      var cards = h(
        "div",
        { className: "dscc-cards" },
        card("会话记录", String(totals.sessionCount == null ? allSessions.length : totals.sessionCount)),
        card("会话体积", fmtSize(totals.sessionBytes)),
        card("可清理", String(cleanable.length) + (cleanableBytes ? " · " + fmtSize(cleanableBytes) : "")),
        card("使用中", String(totals.liveCount == null ? allSessions.filter(function (s) { return s.live; }).length : totals.liveCount)),
        card("归档缓存", String(totals.archiveCount == null ? archives.length : totals.archiveCount)),
        card("回收站", String(trash.length) + (totals.trashBytes ? " · " + fmtSize(totals.trashBytes) : ""))
      );

      var bar = h(
        "div",
        { className: "dscc-bar" },
        h("button", { className: "dscc-btn", disabled: busy, onClick: function () { run("刷新", function () { return Promise.resolve(""); }); } }, "刷新"),
        h("button", { className: "dscc-btn", disabled: busy, onClick: function () { reveal("sessions"); } }, "打开会话目录"),
        h("button", { className: "dscc-btn", disabled: busy, onClick: function () { reveal("trash"); } }, "打开回收站"),
        h(
          "label",
          { style: { display: "flex", alignItems: "center", gap: 5, fontSize: 12, cursor: "pointer" }, title: "允许删除正在写入的会话" },
          h(Checkbox, { checked: force, onChange: function (e) { setForce(e.target.checked); } }),
          "强制"
        ),
        h("input", {
          className: "dscc-input",
          placeholder: "搜索标题 / 项目 / ID",
          value: q,
          onChange: function (e) { setQ(e.target.value); }
        }),
        q
          ? h("button", { className: "dscc-btn", onClick: function () { setQ(""); } }, "清除搜索")
          : null,
        h(
          "select",
          {
            className: "dscc-input",
            value: sortBy,
            title: "排序方式",
            onChange: function (e) { setSortBy(e.target.value); }
          },
          h("option", { value: "time" }, "时间：新→旧"),
          h("option", { value: "old" }, "时间：旧→新"),
          h("option", { value: "size" }, "体积：大→小"),
          h("option", { value: "turns" }, "轮数：多→少")
        ),
        h("span", { style: { flex: 1 } }),
        selCount
          ? h("span", { className: "dscc-sub" }, "已选 " + selCount + " 项 · " + fmtSize(selBytes))
          : null,
        selCount
          ? h("button", { className: "dscc-btn", disabled: busy, onClick: function () { setSel({}); } }, "取消全选")
          : null
      );

      var sessionRows = sessions.length
        ? sessions.map(function (s) {
            var key = sKey(s);
            return h(
              "div",
              {
                className: "dscc-row",
                key: key,
                style: { cursor: "pointer" },
                onClick: function (ev) {
                  if (ev.target && ev.target.tagName === "INPUT") return;
                  if (s.live && !force) {
                    setMsg("这一条正在使用中（最近 1 分钟还在写入）—— 已阻止；确实要删就先勾上面的「强制」");
                    return;
                  }
                  toggle(key, !sel[key]);
                }
              },
              h(Checkbox, {
                checked: !!sel[key],
                disabled: s.live && !force,
                onChange: function (e) { toggle(key, e.target.checked); }
              }),
              h("div", { className: "dscc-name", title: s.title || s.id }, (s.title || "(无标题)") + "  ·  " + shorten(s.id, 22)),
              s.live ? h("span", { className: "dscc-tag live" }, "使用中") : null,
              h("span", { className: "dscc-tag" }, s.project),
              h("span", { className: "dscc-meta" }, fmtSize(s.size)),
              h("span", { className: "dscc-meta" }, (s.turns || 0) + " 轮"),
              h("span", { className: "dscc-meta" }, fmtAge(s.ageMs))
            );
          })
        : h("div", { className: "dscc-empty" }, "没有会话记录");

      var archiveRows = archives.length
        ? archives.map(function (a) {
            var key = aKey(a);
            return h(
              "div",
              {
                className: "dscc-row",
                key: key,
                style: { cursor: "pointer" },
                onClick: function (ev) {
                  if (ev.target && ev.target.tagName === "INPUT") return;
                  toggle(key, !sel[key]);
                }
              },
              h(Checkbox, { checked: !!sel[key], onChange: function (e) { toggle(key, e.target.checked); } }),
              h("div", { className: "dscc-name", title: a.title || a.file }, (a.title || "(无标题)") + "  ·  " + shorten(a.file, 30)),
              h("span", { className: "dscc-tag" }, a.project || "?"),
              h("span", { className: "dscc-meta" }, fmtSize(a.size)),
              h("span", { className: "dscc-meta" }, fmtAge(a.ageMs))
            );
          })
        : h("div", { className: "dscc-empty" }, "没有归档缓存");

      var trashRows = trash.length
        ? trash.map(function (t) {
            var key = tKey(t);
            return h(
              "div",
              {
                className: "dscc-row",
                key: key,
                style: { cursor: "pointer" },
                onClick: function (ev) {
                  if (ev.target && ev.target.tagName === "INPUT") return;
                  toggle(key, !sel[key]);
                }
              },
              h(Checkbox, { checked: !!sel[key], onChange: function (e) { toggle(key, e.target.checked); } }),
              h("div", { className: "dscc-name", title: t.id || t.trashId }, shorten(t.id || t.trashId || "?", 60)),
              h("span", { className: "dscc-tag" }, t.kind === "archive" ? "归档" : "会话"),
              t.project ? h("span", { className: "dscc-tag" }, t.project) : null,
              h("span", { className: "dscc-meta" }, fmtSize(t.bytes)),
              h("span", { className: "dscc-meta" }, t.at ? fmtTime(t.at) + " 移入" : String(t.bucket || ""))
            );
          })
        : h("div", { className: "dscc-empty" }, "回收站是空的");

      var section = function (title, extra, rows, cls) {
        return h(
          "div",
          { className: "dscc-sec", key: title },
          h("div", { className: "dscc-sec-h" }, h("span", null, title), h("span", { className: "dscc-grow" }), extra || null),
          // 每个区的行都套一层可滚动容器：即使外层布局不给高度，也能各自滚动、三区都看得到
          h("div", { className: "dscc-rows" + (cls ? " " + cls : "") }, rows)
        );
      };

      var sessionsSec = section(
        "会话记录（" + sessions.length + "）",
        h(
          "span",
          { style: { display: "flex", gap: 6, flexWrap: "wrap" } },
          h(
            "button",
            {
              className: "dscc-btn",
              disabled: busy,
              onClick: function () {
                patch(
                  sessions
                    .filter(function (s) {
                      return !s.live || force;
                    })
                    .map(sKey),
                  true
                );
              }
            },
            "全选"
          ),
          h(
            "button",
            {
              className: "dscc-btn",
              disabled: busy,
              onClick: function () {
                patch(
                  sessions
                    .filter(function (s) {
                      return (Number(s.ageMs) || 0) > 30 * DAY && (!s.live || force);
                    })
                    .map(sKey),
                  true
                );
              }
            },
            "只选 30 天前"
          ),
          h("button", { className: "dscc-btn", disabled: busy, onClick: function () { patch(sessions.map(sKey), false); } }, "清空选择"),
          h(
            "button",
            {
              className: "dscc-btn danger",
              disabled: busy,
              onClick: function () {
                doTrash(
                  pickSessions().map(function (s) {
                    return { kind: "session", project: s.project, id: s.id };
                  }),
                  "会话"
                );
              }
            },
            "移入回收站"
          )
        ),
        sessionRows,
        "rows-sessions"
      );

      var archivesSec = section(
        "归档缓存（" + archives.length + "）",
        h(
          "span",
          { style: { display: "flex", gap: 6 } },
          h("button", { className: "dscc-btn", disabled: busy, onClick: function () { patch(archives.map(aKey), true); } }, "全选"),
          h(
            "button",
            {
              className: "dscc-btn",
              disabled: busy,
              onClick: function () {
                patch(
                  archives
                    .filter(function (a) {
                      return (Number(a.ageMs) || 0) > 30 * DAY;
                    })
                    .map(aKey),
                  true
                );
              }
            },
            "只选 30 天前"
          ),
          h("button", { className: "dscc-btn", disabled: busy, onClick: function () { patch(archives.map(aKey), false); } }, "清空选择"),
          h(
            "button",
            {
              className: "dscc-btn danger",
              disabled: busy,
              onClick: function () {
                doTrash(
                  pickArchives().map(function (a) {
                    return { kind: "archive", file: a.file };
                  }),
                  "归档"
                );
              }
            },
            "移入回收站"
          )
        ),
        archiveRows,
        "rows-archives"
      );

      var trashSec = section(
        "回收站（" + trash.length + (totals.trashBytes ? " · " + fmtSize(totals.trashBytes) : "") + "）",
        h(
          "span",
          { style: { display: "flex", gap: 6 } },
          h("button", { className: "dscc-btn", disabled: busy || !trash.length, onClick: doRestore }, "恢复选中"),
          h("button", { className: "dscc-btn", disabled: busy, onClick: function () { patch(trash.map(tKey), true); } }, "全选"),
          h("input", {
            className: "dscc-input purge",
            placeholder: "输入 清空",
            title: "确认真删：在这里输入「清空」两个字后，右边按钮才可点",
            value: purgeWord,
            onChange: function (e) { setPurgeWord(e.target.value); }
          }),
          h(
            "button",
            {
              className: "dscc-btn danger",
              disabled: busy || !trash.length || purgeWord.trim() !== "清空",
              title: purgeWord.trim() === "清空" ? "真删回收站里的全部内容（不可恢复）" : "先输入「清空」两个字",
              onClick: doPurge
            },
            "彻底清空"
          )
        ),
        trashRows,
        "rows-trash"
      );

      return h(
        "div",
        { className: "dscc-root" },
        header,
        cards,
        bar,
        h(
          "div",
          { className: "dscc-msg" },
          msg || "删除 = 先移入回收站（" + (data.root || "") + "\\session-trash），可随时恢复；「彻底清空」才真的删。"
        ),
        h("div", { className: "dscc-body" }, sessionsSec, archivesSec, trashSec)
      );
    }

    function CleanerIcon(props) {
      var size = Number(props && props.size) || 18;
      return h(
        "span",
        {
          title: "会话清理",
          style: {
            width: size,
            height: size,
            display: "grid",
            placeItems: "center",
            fontSize: Math.max(11, Math.round(size * 0.62)),
            lineHeight: 1,
            opacity: props && props.active ? 1 : 0.7
          }
        },
        "🧹"
      );
    }

    exports.name = "dsh-session-janitor";
    exports.inject = ["slots"];
    exports.apply = function apply(ctx) {
      ctx.slots.inject("sidebar.panellist", function () {
        return ctx.slots.register({ name: "sidebar.panellist", id: PANEL_ID, order: 120, label: "会话清理" }, function () {
          return h(CleanerIcon);
        });
      });
      ctx.slots.inject("main", function () {
        return ctx.slots.register({ name: "main", key: PANEL_ID }, function () {
          return h(CleanerPanel);
        });
      });
    };

    return module.exports;
  }
});
