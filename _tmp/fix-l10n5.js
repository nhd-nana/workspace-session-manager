const fs = require('fs');
const p = 'l10n/bundle.l10n.zh-cn.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
delete j['Close ALL VS Code windows, then run:\n\n    node scripts/apply-pending.js --apply\n\nIt writes and exits immediately — no background process is left behind.'];
j['Applied automatically once VS Code is closed (scheduled task; you can also run scripts/apply-pending.js --apply yourself). No process stays running in the background. Right-click the "Pending renames" group to undo.']
    = '**关闭 VS Code 后会自动应用**（计划任务；也可以自己跑 `scripts/apply-pending.js --apply`）。不会有任何进程常驻后台。想反悔：右键「待办改名」分组撤销。';
fs.writeFileSync(p, JSON.stringify(j, null, 4) + '\n', 'utf8');
console.log('条目数', Object.keys(j).length);
