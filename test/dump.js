// 原样打印会话文件内容（诊断用）
const fs = require('fs');
const path = require('path');

const WS = path.join(process.env.APPDATA, 'Code', 'User', 'workspaceStorage');
const hash = process.argv[2];
const ids = process.argv.slice(3);
const limit = Number(process.env.DUMP_LIMIT || 2000);

for (const id of ids) {
  const f = path.join(WS, hash, 'chatSessions', id + '.jsonl');
  if (!fs.existsSync(f)) { console.log('--- 文件不存在:', id); continue; }
  const st = fs.statSync(f);
  console.log(`\n=========== ${id}   ${st.size} B ===========`);
  console.log(fs.readFileSync(f, 'utf8').slice(0, limit));
  console.log('----------- end -----------');
}
