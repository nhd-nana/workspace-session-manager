# 更新日志

## 0.0.16

返璞归真：砍掉从未真正生效、只会造成混乱的机制。

实测结论（证据：队列目录从未生成、自动执行日志从未出现）—— 真正让改名生效的**只有一条链**：
改名写进会话文件 → 你点进那个会话，VS Code 建模型时读回标题 → 索引自动更新。其余都是多余变量。

- **删除待办队列**：`src/pending.js`、视图里的待办分组、逐条撤销、`wsManager.pendingQueue` 设置。
- **删除自动执行**：`scripts/apply-pending.js`、`auto-apply.js`、`auto-apply-hidden.vbs`、
  `manage-task.ps1`、6 个相关命令，并已卸载计划任务 `WorkspaceSessionManager-ApplyPending`。
- **删除 `activationEvents: ["*"]`**。VS Code 自 1.74 起由 contributes 自动推导激活时机，
  不需要（也不应该）写 `*`；写了会让扩展在每个窗口启动时无条件激活，编辑器会警告
  「使用“*”激活通常是一个错误的想法，因为它会影响性能」。
  本扩展现在完全惰性激活：只有打开工作区视图时才加载。
- 改名弹窗简化为一句话：**文件已写好；列表没刷新就点进那个会话一次**。

## 0.0.15

- 🔴 **闪退根因（第二个）：外部「读」`state.vscdb` 也会锁住 VS Code 的写入。**
  回滚日志模式下读事务持 SHARED 锁，写入方拿不到 EXCLUSIVE → `SQLITE_BUSY` →
  主进程未捕获异常 → 闪退（1:34:42 / 1:34:51 两个崩dump 已对应）。
  → `readIndex()` 现在对**有窗口开着**的库一律「**复制到临时目录，读副本**」，不再直接打开。
- 全部提示补上**实测结论：点进那个会话一次，列表标题就会自己刷新**。
  这比“关窗口跑脚本”简单得多，已提到 README 首位。
- 已知风险：junction 安装时 `package.json` 的 version 与目录名不一致时，
  VS Code 可能在重扫时清掉该扩展的 `globalStorage`（本次待办队列就因此丢失）。
  → 日常使用**不要频繁升 version**；队列丢了一不会丢数据（文件早已写好）。
## 0.0.13

- **新增设置 `wsManager.pendingQueue`（默认关）：允许修改打开的工作区（预览版）**
  - **关**（默认）：改名立即写会话文件；但工作区开着时索引不能改（外部写会让 VS Code 闪退），
    所以列表标题**不会变**，弹窗会说明“可能看起来没生效”，并建议关掉该工作区或换窗口改。
    **不产生待办**。
  - **开**：这类改名进**待办队列**，VS Code 关闭后由计划任务自动应用，视图里可逐条撤销。
- 计划任务改用 `schtasks` + `auto-apply-hidden.vbs`（`wscript` 静默启动，不闪黑框）；
  原 `Register-ScheduledTask` 在标准用户下报 `Access is denied`。

## 0.0.12

- **待办清单进了视图**：有待办时顶部出现「待办改名（N 条）」分组，逐条列出标题 / 会话 id / 入队时间；
  右键可**单条撤销**或**清空全部** —— 重启之前随时能反悔。
- **自动执行（可选）**：命令面板 →「安装计划任务」。
  `scripts/auto-apply.js` + 计划任务（登录时 + 每 5 分钟）：
  · 无常驻进程、不弹窗 · 队列为空秒退 · `Code.exe` 在跑秒退 · 每次运行写 `auto-apply.log`。
  任务名 `WorkspaceSessionManager-ApplyPending`，可随时卸载或查看状态。
- `pending.applyAll` 修正：**索引没对上就不出队**（之前 `repairIndex=false` 时只看文件，
  会把“只差索引”的条目静默丢掉，改名永远不显示）。
## 0.0.10

- **全项目统一口径：不再提“重载窗口”**。重载既不会把外部写入带回来，还会触发数据库重写。
  唯一可靠路径 = **关光 VS Code → 跑 `scripts/apply-pending.js --apply`**（写完即退出，不留后台进程）。
- 删除 `BTN_RELOAD` 与所有“点重载”提示；`offerReload()` 改为只在「目标工作区被窗口占用」时如实说明索引没写。
- README 重写「必读」：
  - §0 总则 + 外部写 `state.vscdb` 会闪退的证据
  - §1 离线脚本用法（干跑 → apply → 不驻留）
  - §2 没开着的工作区可直接改
  - 原理章节从「重载为什么能解决」改为「为什么重载解决不了」

## 0.0.9

- 🔴 **修严重缺陷：外部写 `state.vscdb` 会让 VS Code 闪退。**
  实测日志：
  ```
  [storage state.vscdb] transaction(): Error: SQLITE_BUSY: database is locked
  [uncaught exception in main]: Error: SQLITE_BUSY: database is locked
  ```
  0.0.8 在 `activate` 里对**当前窗口正在用**的库做 `BEGIN IMMEDIATE`，VS Code 自己写同一份库时撞锁，
  主进程抛未捕获异常 → Reload 直接关掉。**这是我的错，已堵死。**
- 新增 `src/live.js`：读 `Code.exe` 命令行里的 `--folder-uri` / `--file-uri`，
  判断「 owning 这个库的工作区是否正被某个窗口打开」。
- `sqlite.writeIndex()` 现在**在所有写路径上**先过这道检查（不只改名，修复/搬运一并受保护），
  被占用就拒绝并说明原因；只有 `scripts/apply-pending.js`（VS Code 已退出）才允许写。
- 扩展运行期间**完全不再碰索引**：改名只写会话文件 + 入待办队列。

## 0.0.8

- **修正：改完标题不生效的根因不在文件，在索引。**
  会话文件（`.jsonl` 尾部 `customTitle` 增量）关窗重启都会保留，**已经改对了**；
  但列表显示读的是 `state.vscdb` 里的 `chat.ChatSessionStore.index`，而该索引在窗口运行期间有内存副本，
  任何一次会话变更都会把内存那版整份写回 —— 所以“写盘 → Reload”必然失败，**不是时间不够**。
- `pending.applyAll` 现在同时校对文件与索引，两者都对上才出队；
  `scripts/apply-pending.js` 干跑时把两者的状态分开列出。

## 0.0.7

- **新增「待办改名」队列**：重命名「当前工作区」的会话时，意图会记进队列，
  下次启动 VS Code 时自动补写；也可先退出 VS Code 再跑 `scripts/apply-pending.js --apply`。
- **移除后台分离进程（watcher）**：技术上验证可行（detached 子进程在 VS Code 关闭后仍存活），
  但一个能在父进程被结束后继续运行、静默写文件、还能自己弹窗的东西，与恶意软件的区别只在于动机。
  现改为只用两个你完全掌控的时机：激活时、或你亲手敲的命令。
- 删除 `src/watcher.js`、`scripts/watch-pending.js`、`scripts/stop-watcher.cmd` 与测试命令
## 0.0.7

- **待办改名队列**：改「当前工作区」的会话时，除写文件外再把意图记进
  `globalStorage\gy903.workspace-session-manager\pending-renames.json`，下次启动自动补写（幂等，先看文件尾部有没有同一条 delta）。
- **分离进程 watcher**（`scripts/watch-pending.js`）：记入队列后自动拉起，
  等目标工作区的窗口**全部关闭**再落盘，完成后弹窗确认。VS Code 关闭后它照样活。
- `scripts/apply-pending.js`：手动执行队列，适合完全退出 VS Code 后跑。
- 命令面板新增「测试：拉起分离进程 watcher」，用来验证 detached 子进程能否活过窗口关闭。

## 0.0.6

- **修正 0.0.5 的错误建议**：重命名「当前工作区」的会话后**不要**重载窗口——
  重载会触发 VS Code 按内存里的标题整体重写会话文件（紧凑格式），正好把追加的增量抹掉。
  现在改为直接说明「请到另一个窗口改这种会话」。
- 实测结论（129 个会话文件）：写文件本身可靠，最后一次增量即权威标题；
  失败只发生在**该会话所属的窗口自己保存**时。

## 0.0.5

- **修复：重命名「当前工作区」的会话仍会被覆盖**。这类会话的标题在 VS Code 内存里另有一份，
  写文件后内存会回写旧值 → 现在会提示并一键重载窗口。
  外部工作区的会话不受影响，改完立刻生效。

## 0.0.4

- **新增 `scripts/reset-title-strategy.js`**：让**已有**的 agent-host 会话重新跟随
  `chat.agentHost.experimental.titleGeneration`。那个设置只对新会话生效 ——
  每个会话把当时的策略存进了自己 `session.db` 的 `session_metadata.titleGenerationStrategy`。
  脚本默认只体检，`--apply` 才写；`Code.exe` 在跑时拒绝（`--force` 可跳过）。
- `src/sqlite.js` 导出 `runSql`，供独立脚本复用

## 0.0.3

- **新增「重命名会话」**：把标题以 `{"kind":1,"k":["customTitle"],"v":"…"}` 追加**写进会话文件**，同时更新索引。
  这绕开了 VS Code 的坑：从侧边栏列表改名只写索引，`customTitle` 不落到会话文件，
  下次打开该会话发消息时索引标题会被「首条消息派生的标题」覆盖 —— 表现就是「改完一说话就变回去」。
  只支持 log 格式会话；紧凑（单行）格式会明确拒绝。

## 0.0.2

- **完整的界面本地化**：通知、确认框、报告正文、树节点标签与按钮全部走 `vscode.l10n` ——
  源码以**英文**为准、中文放在 `l10n/bundle.l10n.zh-cn.json`。现在英文界面与中文界面都不再混杂
- **修复**：确认框的按钮文案与判定条件改用同一常量 —— 之前两处各写一遍，改语言时只改一处会让删除确认静默失效
- **修正**：树里「幽灵」条目的说明与 README 对齐（幽灵在面板里同样看不到，不是空白项）

## 0.0.1

首个版本。

- **一览所有工作区存储**：体积构成、会话清单、最后使用时间；`chatSessions` / `chatEditingSessions` /
  各扩展缓存分别标好类别（数据 / 可清理 / 未识别），省得对着 `redhat.java` 这种东西猜能不能删
- **一键修复**：清掉空会话与失效的索引条目，把被隐藏的会话召回面板 —— 就地写盘，完成后提示「立即重载窗口」
- **还原索引备份**：**交换式**回滚到上一次修改之前，再点一次换回来
- **清理可重建的缓存**：含本扩展旧格式的索引备份（走回收站）
- **会话多选**：复制 / 移动到其它工作区（移动会同时注销源索引）
- **查找重复会话**：跨工作区按「文件大小 + 前 64 KB 的 SHA-1」比对指纹，**只出报告、不删任何东西**
- **超大会话预警**：超过 `wsManager.bigSessionMB`（默认 50 MB）的会话在列表里带 ⚠️ 标记
- **界面文案本地化**：命令名、设置说明、视图名跟随 VS Code 的显示语言（`package.nls*.json`）
- **独立脚本**：`scripts/repair-index.js`，可在完全退出 VS Code 后修复索引

> 所有删除都需要二次确认并进入回收站；扩展只做推荐，**绝不自动删**。
