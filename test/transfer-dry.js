// 跨工作区搬运 —— 干跑（只算计划，不复制任何文件、不写任何索引）
require('./stub').install();
const path = require('path');
const store = require('../src/store');
const repair = require('../src/repair');
const transfer = require('../src/transfer');

const u = path.join(process.env.APPDATA, 'Code', 'User');
const ctx = {
  globalStorageUri: { fsPath: path.join(u, 'globalStorage', 'x') },
  storageUri: { fsPath: path.join(u, 'workspaceStorage', (process.env.WSM_HASH || ''), 'g') },
};
const mb = (n) => (n / 1048576).toFixed(2) + ' MB';

(async () => {
  const { items } = store.scan(ctx);
  const src = items.find((i) => i.isCurrent);
  const tgt = items.find((i) => new RegExp(process.argv[2] || '.', 'i').test(i.folderDisplay || '') && !i.isCurrent);
  if (!tgt) return console.log('找不到目标工作区');

  const srcFiles = repair.listSessionFiles(src.dir);
  const tgtIds = new Set(repair.listSessionFiles(tgt.dir).map((f) => path.basename(f, '.jsonl')));

  console.log(`源   : ${src.label}  (${src.folderDisplay})  ${srcFiles.length} 个文件`);
  console.log(`目标 : ${tgt.label}  (${tgt.folderDisplay})  ${tgtIds.size} 个文件`);
  console.log(`目标 isCurrent = ${tgt.isCurrent}  →  ${tgt.isCurrent ? '❌ 不可写索引' : '✅ 可写'}\n`);

  // ① 挑 3 条目标没有的（能真正复制）
  const free = srcFiles.map((f) => path.basename(f, '.jsonl')).filter((id) => !tgtIds.has(id));
  console.log(`源里有 ${free.length} 条是目标没有的`);

  const caseA = free.slice(0, 3);
  const pA = await transfer.plan(caseA, src, tgt);
  console.log('\n--- 场景 A：3 条全新 ---');
  console.log(`  toCopy    ${pA.toCopy.length} 条 (${mb(pA.bytes)})`);
  console.log(`  conflicts ${pA.conflicts.length}   missing ${pA.missing.length}`);
  for (const x of pA.toCopy) {
    const meta = store.readSessionMeta(x.src);
    console.log(`    → ${(meta.title || '(无标题)').slice(0, 52)}`);
  }

  // ② 混入一条目标已存在的，验证冲突检测
  const dup = srcFiles.map((f) => path.basename(f, '.jsonl')).find((id) => tgtIds.has(id));
  const caseB = [...free.slice(0, 1), dup, 'not-exist-id-0000'].filter(Boolean);
  const pB = await transfer.plan(caseB, src, tgt);
  console.log('\n--- 场景 B：1 条可搬 + 1 条重复 + 1 条不存在 ---');
  console.log(`  toCopy    ${pB.toCopy.length}`);
  console.log(`  conflicts ${JSON.stringify(pB.conflicts)}`);
  console.log(`  missing   ${JSON.stringify(pB.missing)}`);

  console.log('\n（本次未复制任何文件、未写入任何索引）');
})();
