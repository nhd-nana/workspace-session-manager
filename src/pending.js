'use strict';
/**
 * pending.js —— 「待办改名」队列。
 *
 * 为什么需要它：
 *   会话数据有两份（磁盘 + 窗口内存）。改「当前窗口打开的那个工作区」的会话时，
 *   窗口下一次保存会把内存版本整体写回，把磁盘上的改动抹掉。
 *   → 那就**先把意图记下来**，等没有进程持有内存时（下次启动 / 完全退出后跑脚本）再落盘。
 *
 * 队列文件：%APPDATA%\Code\User\globalStorage\gy903.workspace-session-manager\pending-renames.json
 *   （故意不用 context.globalStorageUri —— scripts/ 下的独立脚本要在没有 vscode 模块时算出同一个路径）
 *
 * 幂等：执行前先看会话文件**尾部有没有同一条 customTitle delta**
 *   · 有相同值 → 认为已经生效，直接出队
 *   · 没有 / 值不同 → 追加一行 delta（纯增量，重复执行最多多一行无用 delta）
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const titleMod = require('./title');
const { t } = require('./l10n');

const DIR_NAME = 'gy903.workspace-session-manager';
const FILE_NAME = 'pending-renames.json';

function queueDir() {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Code', 'User', 'globalStorage', DIR_NAME);
}
function queuePath() {
    return path.join(queueDir(), FILE_NAME);
}

function load() {
    try {
        const v = JSON.parse(fs.readFileSync(queuePath(), 'utf8'));
        return Array.isArray(v) ? v : [];
    } catch { return []; }
}

function save(list) {
    try {
        fs.mkdirSync(queueDir(), { recursive: true });
        fs.writeFileSync(queuePath(), JSON.stringify(list, null, 2), 'utf8');
        return true;
    } catch { return false; }
}

/** 同一个会话只保留最新一条意图 */
function add(entry) {
    const list = load().filter((x) => x.file !== entry.file);
    list.push({ file: entry.file, id: entry.id, dir: entry.dir, title: entry.title, ts: Date.now() });
    return save(list) ? list.length : -1;
}

/**
 * 读文件**尾部**最后一条 customTitle delta。
 * 追加的 delta 一定在文件末尾（若之后文件被整体重写成紧凑格式，delta 就消失了 → 返回 null）。
 */
function tailDelta(file, bytes = 1 << 20) {
    const size = fs.statSync(file).size;
    const start = Math.max(0, size - bytes);
    const fd = fs.openSync(file, 'r');
    try {
        const buf = Buffer.alloc(size - start);
        fs.readSync(fd, buf, 0, buf.length, start);
        // 从末尾往前找，避免尾部被截断的多字节字符影响
        const text = buf.toString('utf8');
        const re = /\{"kind":1,"k":\["customTitle"\],"v":("(?:[^"\\]|\\.)*")\}/g;
        let last = null;
        let m;
        while ((m = re.exec(text)) !== null) last = m[1];
        return last === null ? null : JSON.parse(last);
    } finally {
        fs.closeSync(fd);
    }
}

/**
 * 读索引里的 title；读不到（无 sqlite3 / 条目不存在）返回 null。
 * 列表显示用的是索引，不是会话文件 —— 两边都要对上才算真的改了名。
 */
async function indexTitleOf(e) {
    if (!e.dir || !e.id) return null;
    try {
        const r = await titleMod.readIndexTitle(e.dir, e.id);
        return r.ok ? r.title : null;
    } catch { return null; }
}

/**
 * 执行队列。
 *
 * 🔴 **窗口运行期间只碰文件，绝不写索引。**
 *   `state.vscdb` 是活的 SQLite 连接，外部 `BEGIN IMMEDIATE` 会和 VS Code 抢锁；
 *   而且索引在窗口内存里有完整副本，写了也会被冲掉。所以索引只交给
 *   `scripts/apply-pending.js`（要求 VS Code 已退出）去修。
 *
 * 出队策略是「**跨启动确认两次**」：
 *   第 N 次启动写入 → 标 appliedAt，**继续留队**
 *   第 N+1 次启动再看文件尾部：还是这个标题 → 确实活了 → 出队
 *   被抹掉了（尾部对不上）→ 重写一遍，继续留队
 * 索引没跟上的，留在队列里等脚本收尾。
 *
 * @param {{repairIndex?:boolean, currentDbPath?:string|null}} opts
 *        repairIndex 只在「VS Code 已退出」的脚本里传 true。
 */
async function applyAll(opts = {}) {
    const list = load();
    const applied = [];
    const confirmed = [];
    const dropped = [];
    const failed = [];
    const indexPending = [];
    const keep = [];
    const MAX_AGE = 90 * 86400000;
    const repairIndex = opts.repairIndex === true;

    for (const e of list) {
        if (!e || !e.file || !e.title) { dropped.push({ e, reason: 'bad entry' }); continue; }
        if (Date.now() - (e.ts || 0) > MAX_AGE) {
            dropped.push({ e, reason: t('The session file no longer exists.') });
            continue;
        }
        if (!fs.existsSync(e.file)) {
            dropped.push({ e, reason: t('The session file no longer exists.') });
            continue;
        }
        let cur = null;
        try { cur = tailDelta(e.file); } catch (err) {
            failed.push({ e, reason: String((err && err.message) || err) });
            keep.push(e);
            continue;
        }

        const fileOk = cur === e.title;
        if (!fileOk) {
            const w = titleMod.writeTitleToFile(e.file, e.title);
            if (!w.ok) { failed.push({ e, reason: w.error }); keep.push(e); continue; }
            applied.push(e);
        }

        // 索引：仅在「VS Code 已退出」的脚本模式下调校
        let idxOk = null;
        if (repairIndex && e.dir && e.id) {
            const idx = await indexTitleOf(e);
            idxOk = idx !== null && idx === e.title;
            if (!idxOk) {
                try {
                    const r = await titleMod.writeTitleToIndex(e.dir, e.id, e.title, opts.currentDbPath || null);
                    idxOk = r.ok;
                } catch { idxOk = false; }
            }
            if (!idxOk) indexPending.push(e);
        }

        // 出队条件：文件在**上一次启动**就已经对上，且（要求修索引时）索引也对上
        if (fileOk && e.appliedAt && (idxOk === null || idxOk)) { confirmed.push(e); continue; }
        keep.push({ ...e, appliedAt: Date.now() });
    }

    save(keep);
    return { applied, confirmed, dropped, failed, indexPending, remaining: keep.length };
}

module.exports = { queueDir, queuePath, load, save, add, tailDelta, applyAll };
