// 只读:打印 list()/trashList() 的真实返回结构(默认根 = ~/.dsh)
import { list, trashList } from "../lib/store.js";

const data = list({});
const out = {
  root: data.root,
  sessionCount: data.sessions.length,
  archiveCount: data.archives.length,
  trashCount: data.trash.entries.length,
  totalsKeys: Object.keys(data.totals ?? {}),
  sessionSample: data.sessions.slice(0, 2),
  archiveSample: data.archives.slice(0, 2),
  trashSample: data.trash.entries.slice(0, 2),
  trashKeys: Object.keys(data.trash),
  trashListSample: trashList({})
};
console.log(JSON.stringify(out, null, 2));
