const fs = require('fs');
const p = 'l10n/bundle.l10n.zh-cn.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
j['Cannot snapshot the live database: {0}'] = '无法给正在使用的数据库做快照：{0}';
fs.writeFileSync(p, JSON.stringify(j, null, 4) + '\n', 'utf8');
console.log('条目数', Object.keys(j).length);
