const fs = require('fs');

// package.nls (en + zh) 补 config.pendingQueue
const en = JSON.parse(fs.readFileSync('package.nls.json', 'utf8'));
en['config.pendingQueue'] = '**Preview.** When the workspace a session belongs to is open in a window, its session index cannot be written from outside (VS Code would hit SQLITE_BUSY and crash). With this on, such renames are queued and applied automatically after VS Code closes. Off: the rename is written to the session file immediately but the title in the list stays unchanged — close that workspace, or rename it from another window instead.';

const zh = JSON.parse(fs.readFileSync('package.nls.zh-cn.json', 'utf8'));
zh['config.pendingQueue'] = '**预览版。** 会话所属的工作区正开在某个窗口里时，它的会话索引不能从外部写（VS Code 会撞上 SQLITE_BUSY 而闪退）。\n\n- **开启**：这类改名会进入**待办队列**，在 VS Code 关闭后自动应用（计划任务 / 独立脚本）。\n- **关闭**（默认）：改名会立即写进会话文件，但**列表里的标题不会变** —— 只能听天由命，建议先关掉那个工作区，或从另一个窗口改。';

fs.writeFileSync('package.nls.json', JSON.stringify(en, null, 4) + '\n', 'utf8');
fs.writeFileSync('package.nls.zh-cn.json', JSON.stringify(zh, null, 4) + '\n', 'utf8');

// l10n bundle 补两条新弹窗文案
const p = 'l10n/bundle.l10n.zh-cn.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));
j['Renamed to "{0}" in the session file. That workspace is open, so the list title (which comes from the index) is queued — it gets applied after VS Code is closed.']
    = '已在会话文件里改名为「{0}」。那个工作区正开着，列表标题（读的是索引）先记入**待办队列**，等 VS Code 关闭后自动应用。';
j['Renamed to "{0}" in the session file, but the title in the list was NOT updated: that workspace is open in a window, and writing its index from outside makes VS Code crash (SQLITE_BUSY). So this rename may look like it did not happen. Close that workspace first, or rename it from another window.']
    = '已在会话文件里改名为「{0}」，但**列表标题没有更新**：那个工作区正开着，而从外部写它的索引会让 VS Code 撞上 SQLITE_BUSY 闪退。所以这次改名看起来可能像没生效。建议先关掉那个工作区，或从另一个窗口改。';
j['Tip: turn on "Allow editing open workspaces (preview)" in the settings to queue such renames and have them applied automatically after VS Code closes.']
    = '提示：在设置里开启「允许修改打开的工作区（预览版）」，这类改名就会进入待办队列，VS Code 关闭后自动应用。';

fs.writeFileSync(p, JSON.stringify(j, null, 4) + '\n', 'utf8');
console.log('ok');
