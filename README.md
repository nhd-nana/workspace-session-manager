# Workspace & Session Manager — 工作区与会话管家

> English: [**README.en.md**](README.en.md)

一览 VS Code 的全部工作区存储与 Copilot 会话：体积占用、会话清单、**被隐藏的会话**、失效的索引条目，并可就地修复。

> **只推荐，不自动删。** 所有删除都由你右键显式触发 + 二次确认 + 进回收站。

（扩展的界面文案——命令名、设置说明、视图名——跟随 VS Code 的显示语言。）

---

## ⚠️ 必读

### 1. 修复后要重载窗口（扩展会直接给你按钮）

VS Code 把会话索引缓存在**内存**里。若那个工作区正开着，它下次会话变更（发消息 / 新建 / 改标题）会把内存版本整体写回盘上，**覆盖**刚做的修复。

**不需要关 VS Code，也不需要换窗口** —— 扩展直接写盘，完成后弹一个「**立即重载窗口**」按钮：

| 目标工作区 | 做法 |
|---|---|
| 就是**当前**窗口 | 点提示里的「立即重载窗口」 |
| 开在**别的**窗口 | 到那个窗口执行 `Developer: Reload Window` |
| 没开在任何窗口 | 什么都不用做 |

> 原理：`flushIndex()` 只在**会话变更**时触发，重载本身不会回写 —— 所以「写盘 → 立刻重载」这个窗口期是安全的，只要别在这几秒里发消息。
> 想彻底免掉重载，可以用 `scripts\` 里的独立脚本（完全退出 VS Code 后运行）。

### 2. 「清理空会话」只看内容，不看标题

判据是会话文件里 `requests` 数组为空 —— **从未发出过任何一条消息**。
标题为空、或叫「新建聊天」，只是**信号**而非判据；**有内容的会话永远不会被动到**。

### 3. 当前工作区没有「删除存储」入口

不是点了报错，是**菜单里就不出现**（它用的是独立的 `contextValue`，`when` 子句直接排除）。
因为它正被 VS Code 占用 —— `state.vscdb` 是活的 SQLite 连接，强删可能留下**残缺目录**，比全删更难收拾。

### 4. 误删可以还原，但要先完全退出 VS Code

工作区存储的目录名是**由工作区路径算出的稳定 hash**（同一个目录永远同一个），把它从回收站还原回原位即可复用，会话与状态都会回来。

⚠️ 但 VS Code 若还在运行，它很可能已经重建了同名空目录 → 还原时**撞名失败**（变成 `xxx (1)`）。
**正确顺序：退出 VS Code → 还原 → 再启动。**

---

## 名词表（先看这个，后面都靠它）

会话的可见性由**两个互相独立的维度**决定，混起来就会看不懂。

**维度一：索引 / 文件是否对得上**

| 名称 | 含义 | 面板里 |
|---|---|---|
| 正常 | 索引有登记 + 磁盘有文件 | 显示 |
| **孤儿** | **磁盘有文件、索引没登记** | **看不见** —— 文件没丢，只是没有入口 |
| **幽灵** | **索引有登记、磁盘没文件** | **看不见** —— 见下方说明 |

**维度二：有没有内容**

| 名称 | 含义 | 面板里 |
|---|---|---|
| 有内容 | 发过消息 | 显示 |
| **空会话** | 一条消息都没发过（刚建时文件约 1.5 KB，只含界面状态） | **看不见**；新建后可能**闪现一下**再消失——那是刷新节流，**不是被删** |

> **面板实际显示 = 索引有 ∩ `isExternal:false` ∩ `initialLocation:"chat"` ∩ `isEmpty:false`**
> —— 这是 `ChatService.getHistorySessionItems()` 的原始过滤条件。它**不检查文件是否存在**。

### 幽灵和空会话为什么都不显示

两者在面板里都**不会**出现，原因不同、结论一致：

- **空会话**：索引条目里 `isEmpty: true` → 被上面那条过滤条件直接刷掉。条目**仍在索引里占位**（只有 `clearSession` 才会真删）。
- **幽灵**：文件不存在这件事本身就**必然意味着它没发过消息** —— VS Code 写 JSONL 与写索引走的是同一条路径（`storeSessions`），发过消息就一定有文件。所以幽灵的 `isEmpty` 也是 `true` → 同样被刷掉。
- **例外（要清的就是这种）**：文件被**外部工具**删掉或搬走、而索引没跟着改 —— 索引里存的是陈旧的 `isEmpty: false`。这种幽灵**会**进列表，点开才加载失败，看起来就是个「空白项」。

> 所以判定空会话**不能依赖索引里的 `isEmpty`**（它可能陈旧或标错），必须去读文件内容 —— 这正是本扩展的做法。

**外部会话**：Copilot CLI / Claude 等以 `agent-host-` 为前缀的会话，实体存放在 `%APPDATA%\Code\agentSessionData\`。
它们的 id 含 `:` 和 `/`，**不可能**在 `chatSessions\` 里对上文件 —— 所以**永远不要**把它们当作幽灵清理。

---

## 用法

资源管理器侧边栏 → **工作区管家**。在工作区节点上右键：

| 命令 | 作用 |
|---|---|
| **一键修复** | 清掉空会话与失效条目、把被隐藏的会话召回面板（怎么做的不重要，详情见文末原理） |
| **还原索引备份** | 把索引回退到上一次修改之前。**交换式**：再点一次就换回来 |
| **清理可重建的缓存** | 清掉各扩展的工作区缓存与本扩展**旧格式**的索引备份（走回收站）。**不碰**会话数据与索引本体 |
| 打开此工作区 / 在资源管理器中打开目录 / 复制路径 | — |
| 删除此工作区存储 | 仅非当前工作区可见，进回收站 |

> 每次改动索引前，都会把 `state.vscdb` 备份成同目录下的 `state.vscdb.wsmgr-bak` —— **只保留这一份，每次覆盖**，不会越攒越多。

标题栏另有 **刷新**、**生成总览报告** 与 **查找重复会话**。悬停工作区节点可看到完整信息：目标路径、是否存在、体积构成、最后使用时间。

> **查找重复会话**：跨所有工作区比对指纹（**文件大小 + 前 64 KB 的 SHA-1**，实测 105 个文件耗时 ~46 ms）。
> 同工作区内不会重复（文件名就是 sessionId）；重复几乎都来自**会话同步/搬运工具**把同一份 JSONL 复制到多个工作区。
> 它**只生成报告，不删任何东西**。

展开某个工作区，**存储明细**里每一项都带了类别标记——省得你对着 `redhat.java` 这种东西猜能不能删：

| 图标 | 类别 | 含义 |
|---|---|---|
| 🔒 | **数据** | `chatSessions` / `chatEditingSessions` / `state.vscdb` / `workspace.json` —— **不要动** |
| 📦 | **可清理** | 扩展的工作区缓存（删后自动重建，可能慢一次）、旧格式的索引备份 |
| ❓ | **未识别** | 用途不明 —— **不建议清理** |

> 分类原则是**宁少勿多**：白名单只标数据，扩展目录按缓存处理，认不出的一律不给清理建议。
> `state.vscdb.backup`（VS Code 自己的）与当前那份额外的索引备份也**不在**可清范围 —— 它们是回退用的保底。

> 命令面板里另有细粒度的 **修复会话索引** 与 **清理空会话**，用于单独执行其中一步。

**会话节点右键**（支持 Ctrl / Shift 多选）：

| 命令 | 作用 |
|---|---|
| **复制会话到…** | 复制到另一个工作区，**源会话不受影响** |
| **移动会话到…** | 复制到目标 + 源文件移入回收站 + 源索引注销 |
| **重命名会话** | 把标题写进**会话文件**（`customTitle`），而不是只改索引 —— 否则下次发消息就被自动标题覆盖 |
| 删除会话 | 进回收站，支持多选 |

⚠️ 搬运后若涉及当前工作区，同样需要按提示重载窗口。

⚠️ **重命名「当前工作区」的会话必须重载窗口才生效**：VS Code 内存里另存了一份标题，会把刚写的值盖回去。
改**其它**工作区的会话则立刻生效，不用重载 —— 所以一次性改不完的话，先改别的、最后统一重载一次最省事。

### 推荐用法

右键工作区 → **一键修复** → 按提示点「**立即重载窗口**」。

就这一步。（想分步来，也可以用命令面板里的「修复会话索引」/「清理空会话」。）

### 避免超大会话

会话文件是**只增不减**的：工具输出、附件都会被原样写进去（附件还会 **base64 内联**，体积 ×1.33），
而且同一份数据会同时存进 `result` 和 `response` 两个字段。在几十万文件的仓库里裸跑一次 `git ls-files`，
就可能造出几百 MB 的会话。

| 做法 | 说明 |
|---|---|
| **给命令加限制** | `git ls-files \| Select-Object -First 200`；列文件用 Everything CLI（`es.exe`）而不是 `Get-ChildItem -Recurse` |
| **别把大文件 / 图片丢进聊天框** | 附件会被 base64 内联 —— 一张 5 MB 的图 ≈ 6.7 MB 文本。改成"我把路径给你，按需读" |
| **一个任务一个会话** | 会话越长、快照越大；顺带也避免老的被 `trimEntries` 挤成孤儿 |
| **盯住体积列** | 「会话」列表里每项都有体积；超过 `wsManager.bigSessionMB`（默认 **50 MB**）会带 ⚠️ 标记 |
| **发现巨物后别在里面继续聊** | 只会更大。记下要点 → 用「删除会话（回收站）」清掉 |

> ⚠️ 这类会话是**单个巨型 `kind0` 快照（整个文件一行）**，走的是 VS Code 的 "flat" 写入路径。
> 用 `readline` 之类逐行读取会**卡死**（单行可达数百 MB）。

### 独立脚本（脱离 VS Code 运行）

想彻底免掉「重载」这一步时用 —— 完全退出 VS Code 后执行。

```powershell
node scripts\repair-index.js --list                     # 列出所有工作区
node scripts\repair-index.js --hash <hash>              # 体检，不写任何东西
node scripts\repair-index.js --hash <hash> --apply      # 写入（请先完全退出 VS Code）
node scripts\repair-index.js --path "d:\your-project" --apply
```

检测到 `Code.exe` 正在运行时会**拒绝写入**（`--force` 可跳过，后果自负）。

### 让「已有」agent 会话也跟随标题策略

`chat.agentHost.experimental.titleGeneration` **只对新会话生效** —— 每个会话把当时的策略存进了
自己 `session.db` 的 `session_metadata.titleGenerationStrategy`，之后一直按那份走。
想把老会话改过来，用这个脚本（同样建议先完全退出 VS Code）：

```powershell
node scripts\reset-title-strategy.js                  # 只体检：打印现状分布
node scripts\reset-title-strategy.js --apply          # 全部改成 utility（agent 不再插手命名）
node scripts\reset-title-strategy.js --apply --value agentReview
node scripts\reset-title-strategy.js --apply --delete # 删掉该键 → 回退代码默认 utility
```

---

## 原理

### 存储位置

```
%APPDATA%\Code\User\workspaceStorage\{hash}\
  ├── workspace.json            {"folder":"file:///…"} —— 该存储对应哪个工作区
  ├── chatSessions\{id}.jsonl   会话数据（kind0 全量快照 + kind1 增量 delta）
  ├── chatEditingSessions\
  ├── GitHub.copilot-chat\      debug-logs / transcripts / 会话资源
  └── state.vscdb               内含 chat.ChatSessionStore.index（会话索引）
```

面板显示**只看 `{hash}\state.vscdb` 里的索引** —— `chatSessions\` 里有文件但索引里没登记，就等于没有入口：

```js
{ version: 1, entries: { "<sessionId>": { sessionId, title, lastMessageDate, timing,
    initialLocation: "panel", isEmpty, isExternal, lastResponseState, … } } }
```

> ⚠️ `initialLocation` 必须正好是 `"panel"`（`ChatAgentLocation.Chat` 的值）—— 写成别的值，条目会被面板过滤掉。
> 重建索引条目时这一点极易弄错。

### 孤儿和幽灵是怎么产生的

- `ChatSessionStore.trimEntries()` 的裁剪上限是 **400 条**，而且它**只删索引条目、从不删文件** → 超上限的旧会话就变成**孤儿**（文件还在，没有入口）
- 跨工作区搬运会话文件时若没同步索引，整批都会变孤儿
- 会话是**空着创建**的：创建即写索引，但 JSONL 只在发出第一条消息后才落盘 → 中途放弃就留下**幽灵**
- 因此判定空会话**不能只看 kind0 快照**（那里永远是 `"requests":[]`），必须同时寻找 `"k":["requests",…]` 形式的 delta；文件很大时用流式扫描，找到证据就返回，扫不到则**保守判为有内容**

### 写入为什么会被覆盖，以及重载为什么能解决

`ChatSessionStore.internalGetIndex()` 是**同步**方法，直接返回内存里的 `indexCache`；`flushIndex()` 再把它整体写回盘上。
所以对「正开在窗口里」的工作区写盘，等于和内存里那份旧索引赛跑 —— 输的总是盘上那份。

**但 `flushIndex()` 只在会话变更时触发**（`storeSessions()`），而重载窗口不会触发它（`onWillShutdown` 只 join 已存在的写任务）。
所以「写盘 → 立刻重载」是安全的：重载会重建 `ChatSessionStore`，内存缓存作废并重新从盘上读取。

---

## 开发

```powershell
# F5 → 启动扩展开发主机
node test\smoke.js      # 冒烟测试（不需要 VS Code）
.\build.ps1             # 打包 vsix
```

`test\` 里的探查脚本需要知道「当前窗口对应哪个存储目录」，用环境变量给它：

```powershell
$env:WSM_HASH = '<某项工作区的 hash>'   # 用 node scripts\repair-index.js --list 查看
```

界面文案的本地化在 `package.nls.json`（英，默认）与 `package.nls.zh-cn.json`（中）里；
`_tmp\l10n.js` 能把 `package.json` 的新文案批量换成 `%key%` 占位符并校验两个文件覆盖完整。

## 路线图

- 空间拆解与清理建议

