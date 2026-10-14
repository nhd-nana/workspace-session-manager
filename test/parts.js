// 列出每个工作区的子项构成（为「空间拆解」的分类表做调研）
require('./stub').install();
const path = require('path');
const store = require('../src/store');

const u = path.join(process.env.APPDATA, 'Code', 'User');
const ctx = {
  globalStorageUri: { fsPath: path.join(u, 'globalStorage', 'x') },
  storageUri: {
    fsPath: path.join(u, 'workspaceStorage', process.argv[2] || (process.env.WSM_HASH || ''), 'g'),
  },
};
const mb = (n) => (n / 1048576).toFixed(1);

(async () => {
  const { items } = store.scan(ctx);
  const seen = new Map(); // name → 总字节（跨工作区）
  for (const w of items) {
    store.computeSize(w);
    if (!w.parts || !w.parts.length) continue;
    console.log(`\n${w.label}   ${mb(w.size)} MB`);
    for (const p of w.parts) {
      if (p.bytes <= 0) continue;
      console.log(`   ${String(Math.round(p.bytes / 1024)).padStart(9)} KB  ${p.kind.padEnd(4)}  ${p.name}`);
      seen.set(p.name, (seen.get(p.name) || 0) + p.bytes);
    }
  }
  console.log('\n\n===== 所有出现过的子项（按总体积）=====');
  [...seen.entries()].sort((a, b) => b[1] - a[1]).forEach(([n, b]) => {
    console.log(`  ${mb(b).padStart(10)} MB  ${n}`);
  });
})();
