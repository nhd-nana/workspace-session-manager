// 全盘扫描：列出每个工作区里「按内容判定为空」的会话（不管索引的 isEmpty 标记）
require('./stub').install();
const fs = require('fs');
const path = require('path');
const store = require('../src/store');
const repair = require('../src/repair');

const u = path.join(process.env.APPDATA, 'Code', 'User');
const ctx = {
  globalStorageUri: { fsPath: path.join(u, 'globalStorage', 'x') },
  storageUri: {
    fsPath: path.join(u, 'workspaceStorage', process.argv[2] || (process.env.WSM_HASH || ''), 'g'),
  },
};

(async () => {
  const { items } = store.scan(ctx);
  let total = 0;
  for (const w of items) {
    const files = repair.listSessionFiles(w.dir);
    if (!files.length) continue;

    await store.ensureIndex(w);
    const idxIds = w._index && w._index.ids ? w._index.ids : new Set();

    const empties = [];
    for (const f of files) {
      if (repair.isEmptySession(f) === true) {
        const id = path.basename(f, '.jsonl');
        empties.push({ id, size: fs.statSync(f).size, inIndex: idxIds.has(id), markedEmpty: null });
      }
    }
    if (!empties.length) continue;
    total += empties.length;

    console.log(`\n${w.label}  (${w.hash})`);
    console.log(`  文件 ${files.length}　索引条目 ${idxIds.size}　按内容为空 ${empties.length}`);
    for (const e of empties) {
      const mark = w._index && w._index.raw && w._index.raw.entries[e.id]
        ? (w._index.raw.entries[e.id].isEmpty ? '索引标记=空 ' : '索引标记=非空⚠️')
        : '索引里没有  ';
      console.log(`    ${e.inIndex ? '有索引' : '无索引'}  ${mark} ${String(e.size).padStart(6)}B  ${e.id}`);
    }
  }
  console.log(`\n合计按内容为空的会话: ${total} 条`);
})();
