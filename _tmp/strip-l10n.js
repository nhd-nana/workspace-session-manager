const fs = require('fs');
const p = 'l10n/bundle.l10n.zh-cn.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));

// 待办队列 / 计划任务相关的全部作废
const drop = Object.keys(j).filter((k) => /pending|Pending|scheduled task|Scheduled Task|auto-apply|queued|Queue|undo/i.test(k));
for (const k of drop) delete j[k];

console.log('删除', drop.length, '条：');
for (const k of drop) console.log('  - ' + k.slice(0, 70));

fs.writeFileSync(p, JSON.stringify(j, null, 4) + '\n', 'utf8');
console.log('剩余', Object.keys(j).length);
