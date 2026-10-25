const fs = require('fs');
const p = 'l10n/bundle.l10n.zh-cn.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));

delete j['No background process is spawned. To apply it right away, close VS Code and run scripts/apply-pending.js. Renaming sessions of *other* workspaces works immediately.'];
delete j['Renamed to "{0}", but this session belongs to the current workspace: VS Code rewrites the session file from memory when this window saves, which would drop it. It is queued and will be re-applied on the next start.'];
delete j['Renamed to "{0}" in the session file, but the index was not updated: {1}'];

j['Close all VS Code windows, then run: node scripts/apply-pending.js --apply. No background process is spawned. Renaming sessions of *other* workspaces works immediately.']
    = '**关闭所有 VS Code 窗口**，然后跑 `node scripts/apply-pending.js --apply`。不会启动任何后台进程。改**其它**工作区的会话则立刻生效。';

j['Renamed to "{0}" in the session file. This session belongs to the current workspace, so the title shown in the list (which comes from the index) can only be fixed while VS Code is closed — it is queued for that.']
    = '已在会话文件里改名为「{0}」。这个会话属于**当前工作区**，列表显示读的是**索引**，而索引只能在 VS Code 完全关闭时才能改 —— 已记入待办队列。';

j['Renamed to "{0}" in the session file, but the index was not updated: {1} — it is queued for scripts/apply-pending.js.']
    = '已在会话文件里改名为「{0}」，但索引未更新：{1} —— 已记入待办队列，交给 scripts/apply-pending.js。';

fs.writeFileSync(p, JSON.stringify(j, null, 4) + '\n', 'utf8');
console.log('条目数', Object.keys(j).length);
