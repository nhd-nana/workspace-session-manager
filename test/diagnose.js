// 诊断：为什么面板显示的条数 ≠ 索引∩文件 的交集？顺带 dump 一个"空壳"会话的真实内容
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const sqlite = require('../src/sqlite');

const WS = path.join(process.env.APPDATA, 'Code', 'User', 'workspaceStorage');
const hash = process.argv[2] || (process.env.WSM_HASH || '');
const dir = path.join(WS, hash);
const db = path.join(dir, 'state.vscdb');

function q(sql) {
  const r = spawnSync('cmd.exe', ['/c', 'sqlite3', db], {
    input: sql, encoding: 'utf8', windowsHide: true,
  });
  return (r.stdout || '').trim();
}

const fmt = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '?');

(async () => {
  console.log('=== 工作区:', hash, '===\n');

  console.log('--- ItemTable 全部 key ---');
  if (!process.argv.includes('--no-keys')) {
    console.log(q("SELECT key || '   (' || length(value) || 'B)' FROM ItemTable ORDER BY key;"));
  }

  const r = await sqlite.readIndex(db);
  if (!r.ok) return console.log('读索引失败', r.error);
  const e = r.index.entries;
  const keys = Object.keys(e);
  const local = keys.filter((k) => !/[:/]/.test(k));
  const ext = keys.filter((k) => /[:/]/.test(k));

  console.log(`\n--- 索引条目 ${keys.length}（本地 ${local.length} / 外部 ${ext.length}）---`);
  const cnt = (arr, f) => arr.reduce((m, x) => ((m[f(x)] = (m[f(x)] || 0) + 1), m), {});
  console.log('本地 · isEmpty      :', JSON.stringify(cnt(local, (k) => e[k].isEmpty)));
  console.log('本地 · initialLocation:', JSON.stringify(cnt(local, (k) => e[k].initialLocation)));
  console.log('本地 · isExternal   :', JSON.stringify(cnt(local, (k) => e[k].isExternal)));
  console.log('本地 · title=新建聊天:', local.filter((k) => e[k].title === '新建聊天' || e[k].title === 'New Chat').length);

  const jsonl = new Set(fs.readdirSync(path.join(dir, 'chatSessions')).filter((n) => n.endsWith('.jsonl')).map((n) => n.slice(0, -6)));
  const visible = local.filter((k) => jsonl.has(k));
  console.log(`\n--- 可见（索引∩文件）${visible.length} ---`);
  console.log('  其中 isEmpty=true :', visible.filter((k) => e[k].isEmpty).length);
  console.log('  其中 isEmpty=false:', visible.filter((k) => !e[k].isEmpty).length);
  console.log('\n按日期分布:');
  const byDate = {};
  for (const k of visible) {
    const d = fmt(e[k].lastMessageDate);
    byDate[d] = (byDate[d] || 0) + 1;
  }
  Object.entries(byDate).sort().forEach(([d, n]) => console.log(`   ${d}  ×${n}`));

  // 独立文件（孤儿）按大小分档
  const csDir = path.join(dir, 'chatSessions');
  const orphans = [...jsonl].filter((k) => !local.includes(k)).map((k) => {
    const st = fs.statSync(path.join(csDir, k + '.jsonl'));
    return { id: k, size: st.size, mtime: st.mtimeMs };
  });
  console.log(`\n--- 孤儿 ${orphans.length} ---`);
  const tiers = { '<1KB': 0, '1-2KB': 0, '2KB-100KB': 0, '>100KB': 0 };
  for (const o of orphans) {
    if (o.size < 1024) tiers['<1KB']++;
    else if (o.size < 2048) tiers['1-2KB']++;
    else if (o.size < 102400) tiers['2KB-100KB']++;
    else tiers['>100KB']++;
  }
  console.log('  大小分档:', JSON.stringify(tiers));
  const shell = orphans.find((o) => o.size < 2048);
  if (shell) {
    console.log(`\n--- 空壳样本 ${shell.id} (${shell.size}B) 全文 ---`);
    console.log(fs.readFileSync(path.join(csDir, shell.id + '.jsonl'), 'utf8').slice(0, 1400));
  }
})();
