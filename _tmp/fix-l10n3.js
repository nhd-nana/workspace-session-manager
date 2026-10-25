const fs = require('fs');
const p = 'l10n/bundle.l10n.zh-cn.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));

const add = {
    'Drop "{0}" from the pending queue? The session file has already been written; this only cancels the index fix.':
        '把「{0}」从待办队列里撤掉？会话文件已经写过了，这一步只取消索引修复。',
    'Dropped. {0} pending rename(s) left.': '已撤销，还剩 {0} 条待办。',
    'Could not update the queue file.': '无法更新队列文件。',
    'The pending queue is empty.': '待办队列是空的。',
    'Drop all {0} pending rename(s)? Session files keep their current titles; only the index fixes are cancelled.':
        '撤掉全部 {0} 条待办改名？会话文件保持当前标题，只取消索引修复。',
    'Pending queue cleared.': '待办队列已清空。',
    'No automatic run has happened yet.': '还没有自动执行过。',
    'manage-task.ps1 not found in the extension folder.': '扩展目录里找不到 manage-task.ps1。',
    'Workspace & Session Manager — task': '工作区管家 — 计划任务',
    'Pending renames ({0})': '待办改名（{0} 条）',
    'applied automatically once VS Code is closed': '关闭 VS Code 后自动应用',
    'Each entry is written to the session file now, but the title shown in the list lives in the index — which can only be updated while VS Code is closed.':
        '每条都已经写进会话文件了，但列表标题读的是索引 —— 索引只能在 VS Code 完全关闭时更新。',
    '{0} · will be applied offline': '{0} · 离线应用',
    '- Session file: `{0}`': '- 会话文件：`{0}`',
    '- Queued at: {0}': '- 入队时间：{0}'
};
Object.assign(j, add);
fs.writeFileSync(p, JSON.stringify(j, null, 4) + '\n', 'utf8');
console.log('条目数', Object.keys(j).length);
