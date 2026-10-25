const fs = require('fs');
const p = 'l10n/bundle.l10n.zh-cn.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));

delete j['Written into the session file, but this session belongs to the current workspace, and the pending queue could not be saved. Rename it from another window instead.'];
delete j['Renamed to "{0}" in the session file, but the index was not updated: {1} — it is queued for scripts/apply-pending.js.'];
delete j['Renamed to "{0}" in the session file. This session belongs to a workspace that is open in a window, so the title shown in the list (which comes from the index) cannot be fixed right now — it is queued for the offline script.'];

j['Written into the session file, but the pending queue could not be saved. Rename it from another window instead.']
    = '已写进会话文件，但**待办队列保存失败**。请到另一个窗口改这个会话。';
j['Renamed to "{0}" in the session file, but the index was not updated: {1}']
    = '已在会话文件里改名为「{0}」，但索引未更新：{1}';

fs.writeFileSync(p, JSON.stringify(j, null, 4) + '\n', 'utf8');
console.log('条目数', Object.keys(j).length);
