'use strict';
/**
 * title.js —— 给会话「改标题」，并且**真正持久化**。
 *
 * 为什么需要它：VS Code 从侧边栏列表改名时只写索引（`chat.ChatSessionStore.index`），
 * 会话没打开、内存里没有模型 → `customTitle` 不会落到会话文件；等下次打开该会话
 * 发消息时，索引标题会被「从首条消息派生的标题」覆盖 → 表现为「改完一说话就变回去」。
 *
 * 本模块的做法与 VS Code 自己一致：往 .jsonl **追加一行 delta**：
 *   {"kind":1,"k":["customTitle"],"v":"<新标题>"}
 * 重放时后写的覆盖先写的 → 标题就钉住了。**不动那行巨大的 kind0 快照。**
 *
 * 安全约定：
 *   · 只处理 log 格式（首行是 {"kind":0,...}）
 *   · 扁平格式（整个文件一行）不处理 —— 单行可达数百 MB，原地改写不可靠
 *   · 写前不备份文件：追加一行是纯增量操作，失败最多多出一行无用 delta
 */
const fs = require('fs');
const path = require('path');
const sqlite = require('./sqlite');
const { t } = require('./l10n');

/** 首行是否 kind0 快照（log 格式） */
function isLogFormat(file) {
    const fd = fs.openSync(file, 'r');
    try {
        const buf = Buffer.alloc(16);
        const n = fs.readSync(fd, buf, 0, 16, 0);
        return buf.slice(0, n).toString('utf8').startsWith('{"kind":0');
    } finally {
        fs.closeSync(fd);
    }
}

/** 文件末尾是否已经有换行 */
function endsWithNewline(file) {
    const size = fs.statSync(file).size;
    if (size === 0) return true;
    const fd = fs.openSync(file, 'r');
    try {
        const b = Buffer.alloc(1);
        fs.readSync(fd, b, 0, 1, size - 1);
        return b[0] === 0x0a;
    } finally {
        fs.closeSync(fd);
    }
}

/**
 * 把标题写进会话文件（追加 customTitle delta）。
 * @param {string} file 会话 .jsonl 路径
 * @param {string} title 新标题（非空）
 * @returns {{ok:boolean, error?:string, bytes?:number}}
 */
function writeTitleToFile(file, title) {
    if (!fs.existsSync(file)) {
        return { ok: false, error: t('The session file does not exist: {0}', file) };
    }
    if (!isLogFormat(file)) {
        return {
            ok: false,
            error: t('This session uses the compact (single-line) format, so renaming is not supported.')
        };
    }
    const line = JSON.stringify({ kind: 1, k: ['customTitle'], v: title });
    const prefix = endsWithNewline(file) ? '' : '\n';
    fs.appendFileSync(file, prefix + line + '\n', 'utf8');
    return { ok: true, bytes: Buffer.byteLength(prefix + line + '\n', 'utf8') };
}

/**
 * 同步更新索引里的 title（尽力而为）。
 * 当前工作区的索引可能被 VS Code 内存版本覆盖 —— 但文件里已经写入了 customTitle，
 * 下次打开该会话时模型会带上它，索引也就跟着对了。
 * @param {string} dir 工作区存储目录
 * @param {string} id  sessionId
 * @param {string} title 新标题
 * @param {string|null} currentDbPath 当前窗口的库路径（传 null 表示允许写）
 */
async function writeTitleToIndex(dir, id, title, currentDbPath) {
    const dbPath = path.join(dir, 'state.vscdb');
    const r = await sqlite.readIndex(dbPath);
    if (!r.ok) return { ok: false, error: r.error };
    if (!r.index.entries || !r.index.entries[id]) {
        return { ok: false, error: t('This session is not registered in the index (it is an orphan).') };
    }
    const next = JSON.parse(JSON.stringify(r.index));
    next.entries[id].title = title;
    const w = await sqlite.writeIndex(dbPath, next, currentDbPath);
    return w.ok ? { ok: true } : { ok: false, error: w.error };
}

module.exports = { writeTitleToFile, writeTitleToIndex, isLogFormat };
