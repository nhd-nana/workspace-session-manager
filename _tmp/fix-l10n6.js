const fs = require('fs');
const p = 'l10n/bundle.l10n.zh-cn.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));

delete j['Renamed to "{0}" in the session file, but the title in the list was NOT updated: that workspace is open in a window, and writing its index from outside makes VS Code crash (SQLITE_BUSY). So this rename may look like it did not happen. Close that workspace first, or rename it from another window.'];
delete j['Tip: turn on "Allow editing open workspaces (preview)" in the settings to queue such renames and have them applied automatically after VS Code closes.'];

j['Renamed to "{0}" in the session file — that part is persistent. The title in the list was NOT updated: this workspace is open in a window, and writing its index from outside makes VS Code crash (SQLITE_BUSY).']
    = '已在会话文件里改名为「{0}」——**这一半是持久的**。但**列表标题没有更新**：这个工作区正开着，而从外部写它的索引会让 VS Code 撞上 SQLITE_BUSY 闪退。';

j['It usually shows up once that chat is loaded again, but it is lost if that chat is open right now and saves over the file. To be sure: rename it from another window (works immediately), or turn on "Allow editing open workspaces (preview)" so it gets applied automatically after VS Code closes.']
    = '通常**下次加载那个会话时就会显示成新名字**；但如果那个对话此刻正开着并在你继续聊时回写文件，这次改名会丢。要确保生效：① **到另一个窗口**改（立刻生效）；② 开启「允许修改打开的工作区（预览版）」，关闭 VS Code 后自动应用。';

fs.writeFileSync(p, JSON.stringify(j, null, 4) + '\n', 'utf8');
console.log('条目数', Object.keys(j).length);
