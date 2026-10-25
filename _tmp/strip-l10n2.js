const fs = require('fs');
const p = 'l10n/bundle.l10n.zh-cn.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));

// 上一轮已删的旧键残留
delete j['manage-task.ps1 not found in the extension folder.'];
delete j['Workspace & Session Manager — task'];
delete j['applied automatically once VS Code is closed'];
delete j['Each entry is written to the session file now, but the title shown in the list lives in the index — which can only be updated while VS Code is closed.'];
delete j['{0} · will be applied offline'];
delete j['- Session file: `{0}`'];
delete j['Renamed to "{0}" in the session file — that part is persistent. The title in the list was NOT updated: this workspace is open in a window, and writing its index from outside makes VS Code crash (SQLITE_BUSY).'];
delete j['Open that chat once and the list title refreshes by itself (the model reloads the title from the file). It is only lost if that chat is already open and saves over the file. To be safe: rename it from another window (works immediately), or turn on "Allow editing open workspaces (preview)" so it gets re-applied automatically after VS Code closes.'];

// 新措辞
j['Renamed to "{0}" in the session file — that part is persistent. The title in the list is not refreshed yet, because this workspace is open in a window and its index cannot be written from outside.']
    = '已在会话文件里改名为「{0}」——**这一半是持久的**。列表标题还没刷新：这个工作区正开着，而它的索引不能从外部写。';
j['Open that chat once and the title refreshes by itself. It only gets lost if that chat is already open and saves over the file — in that case rename it from another window instead.']
    = '**点进那个会话一次，标题就会自己刷新。** 唯一会丢的情况：那个对话此刻正开着并在你继续聊时回写文件 —— 那种情况请改成到**另一个窗口**里改名。';

fs.writeFileSync(p, JSON.stringify(j, null, 4) + '\n', 'utf8');
console.log('条目数', Object.keys(j).length);
