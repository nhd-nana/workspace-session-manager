const fs = require('fs');
const p = 'l10n/bundle.l10n.zh-cn.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));

// 旧的「重载窗口」口径全部作废
const drop = [
    'Reload Window Now',
    '⚠️ Reload the window **before you keep chatting**.',
    'This window still holds the pre-change index in memory — any session change (send a message / create a session / rename one)',
    ' writes the old copy back to disk and overwrites what was just fixed.',
    'If the affected workspace is open in another window, reload it there **before you keep chatting**,',
    ' otherwise its stale index would overwrite this change. Ignore this if it is not open.',
    'Close all VS Code windows, then run: node scripts/apply-pending.js --apply. No background process is spawned. Renaming sessions of *other* workspaces works immediately.',
    'Renamed to "{0}" in the session file. This session belongs to the current workspace, so the title shown in the list (which comes from the index) can only be fixed while VS Code is closed — it is queued for that.'
];
for (const k of drop) delete j[k];

j['Close ALL VS Code windows, then run:\n\n    node scripts/apply-pending.js --apply\n\nIt writes and exits immediately — no background process is left behind.']
    = '**关闭所有 VS Code 窗口**，然后运行：\n\n    node scripts/apply-pending.js --apply\n\n它会写完立刻退出，**不会留下任何后台进程**。';

j['The index was NOT updated: that workspace is open in a window. Writing it from outside makes VS Code hit SQLITE_BUSY and crash, and the window would overwrite it anyway.']
    = '**索引没有更新**：那个工作区正开在某个窗口里。从外部写会让 VS Code 撞上 SQLITE_BUSY 而闪退，而且窗口里的内存副本也会把它盖回去。';

j['Close that window and run the operation again.']
    = '关掉那个窗口后，重新操作一次。';

j['Renamed to "{0}" in the session file. This session belongs to a workspace that is open in a window, so the title shown in the list (which comes from the index) cannot be fixed right now — it is queued for the offline script.']
    = '已在会话文件里改名为「{0}」。这个会话所属的工作区正开在某个窗口里，**列表标题（读的是索引）现在改不了** —— 已记入待办队列，交给离线脚本。';

fs.writeFileSync(p, JSON.stringify(j, null, 4) + '\n', 'utf8');
console.log('条目数', Object.keys(j).length);
