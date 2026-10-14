// 干跑：统计各工作区「可清理缓存」的体积（不删任何东西）
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
  let grand = 0;
  for (const w of items) {
    store.computeSize(w);
    const cands = (w.parts || []).filter((x) => x.bytes > 0 && store.isCleanable(x.name));
    if (!cands.length) continue;
    const t = cands.reduce((s, x) => s + x.bytes, 0);
    grand += t;
    console.log(`\n${w.label}　可清 ${cands.length} 项 / ${mb(t)} MB　（整个工作区 ${mb(w.size)} MB）`);
    for (const x of cands) console.log(`   ${mb(x.bytes).padStart(10)} MB  ${x.name}`);
  }
  console.log(`\n===== 合计可释放 ${mb(grand)} MB =====`);
})();
