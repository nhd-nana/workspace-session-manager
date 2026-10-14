// 在 VS Code 打包 bundle 里定位会话持久化上限的实现
const fs = require('fs');
const file = process.argv[2];
const kws = (process.argv[3] || 'maxPersistedSessions').split(',');
const s = fs.readFileSync(file, 'utf8');
for (const k of kws) {
  let i = -1;
  let c = 0;
  while ((i = s.indexOf(k, i + 1)) >= 0 && c < 4) {
    console.log('\n===== ' + k + ' @' + i + ' =====');
    console.log(s.slice(Math.max(0, i - 500), i + 500).replace(/\s+/g, ' '));
    c++;
  }
  if (c === 0) console.log('\n===== ' + k + ' : 未找到 =====');
}
