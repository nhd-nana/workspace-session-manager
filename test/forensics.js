// 取证：比对 索引条目 vs chatSessions 文件，看孤儿/幽灵的 mtime 分布，定位成因
require('./stub').install();
const fs = require('fs');
const path = require('path');
const store = require('../src/store');

const u = path.join(process.env.APPDATA, 'Code', 'User');
const ctx = {
  globalStorageUri: { fsPath: path.join(u, 'globalStorage', 'probe') },
  storageUri: { fsPath: path.join(u, 'workspaceStorage', process.argv[2] || (process.env.WSM_HASH || ''), 'g') },
};

const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const bucket = (arr) => {
  const m = {};
  for (const t of arr) m[day(t)] = (m[day(t)] || 0) + 1;
  return Object.entries(m).sort().map(([k, v]) => k + ':' + v).join('  ');
};

(async () => {
  const { items, current } = store.scan(ctx);
  const w = items.find((i) => i.isCurrent) || items[0];
  console.log('工作区:', w.label, '| hash:', w.hash);

  await store.ensureIndex(w);
  const entries = w._index.raw ? w._index.raw.entries : {};
  const indexed = new Set(Object.keys(entries).filter((i) => !i.startsWith('agent-host')));
  const external = Object.keys(entries).filter((i) => i.startsWith('agent-host'));

  const files = w.sessionFiles.map((f) => ({
    id: path.basename(f, '.jsonl'),
    mtime: fs.statSync(f).mtimeMs,
    size: fs.statSync(f).size,
  }));
  const fileIds = new Set(files.map((f) => f.id));

  const both = files.filter((f) => indexed.has(f.id));
  const orphans = files.filter((f) => !indexed.has(f.id));
  const ghosts = [...indexed].filter((i) => !fileIds.has(i));

  console.log('\n本地索引条目:', indexed.size, '| JSONL 文件:', files.length);
  console.log('  可见(交集):', both.length);
  console.log('  孤儿(仅文件):', orphans.length, '(' + (orphans.reduce((a, b) => a + b.size, 0) / 1048576).toFixed(1) + ' MB)');
  console.log('  幽灵(仅索引):', ghosts.length);
  console.log('  外部(CLI,仅索引):', external.length);

  console.log('\n文件 mtime 分布');
  console.log('  可见  :', bucket(both.map((f) => f.mtime)));
  console.log('  孤儿  :', bucket(orphans.map((f) => f.mtime)));

  // 目录本身的时间
  const csDir = path.join(w.dir, 'chatSessions');
  const csSt = fs.statSync(csDir);
  console.log('\nchatSessions 目录 birthtime:', new Date(csSt.birthtimeMs).toISOString().slice(0, 19));

  // 孤儿里最老/最新的文件及其内部创建时间
  const sorted = orphans.slice().sort((a, b) => a.mtime - b.mtime);
  if (sorted.length) {
    console.log('\n孤儿 mtime 最早/最晚:', day(sorted[0].mtime), '/', day(sorted[sorted.length - 1].mtime));
  }

  // state.vscdb 及其备份
  console.log('\nstate.vscdb 家族:');
  for (const n of fs.readdirSync(w.dir)) {
    if (n.startsWith('state.vscdb')) {
      const st = fs.statSync(path.join(w.dir, n));
      console.log('  ', (st.size / 1048576).toFixed(2) + ' MB  ', new Date(st.mtimeMs).toISOString().slice(0, 19), ' ', n);
    }
  }
})();
