const fs = require('fs');
const p = 'l10n/bundle.l10n.zh-cn.json';
const j = JSON.parse(fs.readFileSync(p, 'utf8'));

delete j['Renamed to "{0}" in the session file. That workspace is open, so the list title (which comes from the index) is queued — it gets applied after VS Code is closed.'];
delete j['It usually shows up once that chat is loaded again, but it is lost if that chat is open right now and saves over the file. To be sure: rename it from another window (works immediately), or turn on "Allow editing open workspaces (preview)" so it gets applied automatically after VS Code closes.'];

j['Renamed to "{0}" in the session file. That workspace is open, so the list title (which comes from the index) is queued — opening that chat once refreshes it right away; otherwise it gets applied after VS Code is closed.']
    = '已在会话文件里改名为「{0}」。那个工作区正开着，列表标题（读的是索引）已记入**待办队列** —— **点进那个会话一次就会立刻刷新**；不点的话，关闭 VS Code 后自动应用。';

j['Open that chat once and the list title refreshes by itself (the model reloads the title from the file). It is only lost if that chat is already open and saves over the file. To be safe: rename it from another window (works immediately), or turn on "Allow editing open workspaces (preview)" so it gets re-applied automatically after VS Code closes.']
    = '**点进那个会话一次，列表标题就会自己刷新**（模型会从文件里把标题读回来）。唯一会丢的情况：那个对话此刻正开着，并在你继续聊时回写文件。要确保生效：① 到另一个窗口改（立刻生效）；② 开启「允许修改打开的工作区（预览版）」，关闭 VS Code 后自动重新应用。';

fs.writeFileSync(p, JSON.stringify(j, null, 4) + '\n', 'utf8');
console.log('条目数', Object.keys(j).length);
