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
 * 执行队列。
 * @returns {Promise<{applied:Array, already:Array, dropped:Array, failed:Array, remaining:number}>}
 */
async function applyAll(opts = {}) {
    const list = load();
    const applied = [];
    const already = [];
    const dropped = [];
    const failed = [];

    for (const e of list) {
        if (!e || !e.file) { dropped.push({ e }); continue; }
        if (!fs.existsSync(e.file)) {
            dropped.push({ e, reason: t('The session file no longer exists.') });
            continue;
        }
        let cur = null;
        try { cur = tailDelta(e.file); } catch (err) {
            failed.push({ e, reason: String((err && err.message) || err) });
            continue;
        }
        if (cur === e.title) { already.push(e); continue; }

        const w = titleMod.writeTitleToFile(e.file, e.title);
        if (!w.ok) { failed.push({ e, reason: w.error }); continue; }

        if (!opts.skipIndex && e.dir && e.id) {
            try {
                await titleMod.writeTitleToIndex(e.dir, e.id, e.title, opts.currentDbPath || null);
            } catch { /* 索引尽力而为，文件才是权威 */ }
        }
        applied.push(e);
    }

    // 失败的留在队列里等下次重试
    save(failed.map((x) => x.e));
    return { applied, already, dropped, failed, remaining: failed.length };
}

module.exports = { queueDir, queuePath, load, save, add, tailDelta, applyAll };
