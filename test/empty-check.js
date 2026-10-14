// 空会话核查：用内容判据（requests 是否为空）确认哪些会话是真空的
require('./stub').install();
const path = require('path');
const store = require('../src/store');
const repair = require('../src/repair');

const u = path.join(process.env.APPDATA, 'Code', 'User');
const hash = process.argv[2] || (process.env.WSM_HASH || '');
const ctx = {
  globalStorageUri: { fsPath: path.join(u, 'globalStorage', 'x') },
  storageUri: { fsPath: path.join(u, 'workspaceStorage', hash, 'g') },
};
const fmt = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '?');

(async () => {
  const { items } = store.scan(ctx);
  const w = items.find((i) => i.hash === hash) || items.find((i) => i.isCurrent);
  console.log('工作区:', w.label, '|', w.hash, '\n');

  const p = await repair.plan(w);
  if (!p.ok) return console.log('plan 失败:', p.error);

  const markedEmptyVisible = p.visible.filter((f) => p.entries[f.id] && p.entries[f.id].isEmpty === true);

  console.log('【小文件孤儿】', p.skipped.length, '条 →', '内容确认空:', p.emptyOrphans.length);
  for (const f of p.skipped) {
    const isE = repair.isEmptySession(f.file);
    console.log(`   ${isE === true ? '✅空' : isE === null ? '❓读失败' : '❌有内容'}  ${String(f.size).padStart(6)}B  ${fmt(f.mtime)}  ${f.id}`);
  }

  console.log('\n【可见但索引标记 isEmpty=true】', markedEmptyVisible.length, '条 →', '内容确认空:', p.emptyVisible.length);
  for (const f of markedEmptyVisible) {
    const isE = repair.isEmptySession(f.file);
    console.log(`   ${isE === true ? '✅空' : isE === null ? '❓读失败' : '❌有内容(误标)'}  ${String(f.size).padStart(6)}B  ${fmt(f.mtime)}  ${f.id}`);
  }

  const totalEmpty = p.emptyOrphans.length + p.emptyVisible.length;
  console.log(`\n合计确认空的会话: ${totalEmpty} 条（面板本来就看不见它们）`);
  console.log(`可补入索引: ${p.toAdd.length} 条 | 幽灵条目: ${p.ghost.length} 条`);
})();
