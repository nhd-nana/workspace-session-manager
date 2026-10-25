const fs = require('fs');
const p = 'l10n/bundle.l10n.zh-cn.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
j['Refusing to write: the workspace owning this database is open in a VS Code window. Writing it from outside makes VS Code hit SQLITE_BUSY and crash. Close that window first.']
    = '拒绝写入：拥有这个数据库的工作区正被某个 VS Code 窗口打开。从外部写会让 VS Code 撞上 SQLITE_BUSY 而闪退。请先关掉那个窗口。';
fs.writeFileSync(p, JSON.stringify(j, null, 4) + '\n', 'utf8');
console.log('条目数', Object.keys(j).length);
