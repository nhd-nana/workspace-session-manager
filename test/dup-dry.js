// 干跑：跨工作区重复会话检测
require('./stub').install();
const path = require('path');
const store = require('../src/store');
const dup = require('../src/dup');

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
  const t0 = Date.now();
  const r = dup.findDuplicates(items);
  const ms = Date.now() - t0;

  console.log(`扫描 ${r.scanned} 个会话文件，耗时 ${ms} ms`);
  console.log(`发现 ${r.groups.length} 组重复，冗余约 ${mb(r.bytes)} MB\n`);

  // 与 cleanDuplicates 命令相同的策略：每组保留 mtime 最早的一份
  let dn = 0;
  let db = 0;
  for (const g of r.groups) {
    const sorted = [...g.copies].sort((a, b) => a.mtime - b.mtime);
    for (const c of sorted.slice(1)) { dn++; db += c.size; }
  }
  console.log(`【清理重复副本】默认会删 ${dn} 个，释放 ${mb(db)} MB（每组保留最早一份）\n`);

  for (const g of r.groups.slice(0, 15)) {
    const wasted = g.size * (g.copies.length - 1);
    console.log(`${mb(g.size).padStart(8)} MB ×${g.copies.length}　冗余 ${mb(wasted)} MB　${g.sameId ? '同 ID（典型：复制/同步产物）' : '⚠️ 不同 ID 但内容相同'}`);
    for (const c of g.copies) {
      console.log(`      ${String(c.label).padEnd(32)} ${c.id.slice(0, 8)}`);
    }
  }
  if (r.groups.length > 15) console.log(`... 其余 ${r.groups.length - 15} 组`);
})();
