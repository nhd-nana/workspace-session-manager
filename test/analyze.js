'use strict';
/**
 * 会话可见性分析：把「孤儿」（有文件、无索引 → 面板看不到）与
 * 「幽灵」（有索引、无文件）逐条列出来。
 *
 * 用法： node test/analyze.js [工作区名关键字]
 * 只读：绝不修改任何 state.vscdb。
 */
require('./stub').install();
const path = require('path');
const store = require('../src/store');
const { fmtSize, fmtDate } = require('../src/util');

const userDir = path.join(process.env.APPDATA, 'Code', 'User');
const context = {
    globalStorageUri: { fsPath: path.join(userDir, 'globalStorage', 'gy903.workspace-session-manager') },
    storageUri: { fsPath: path.join(userDir, 'workspaceStorage', (process.env.WSM_HASH || ''), 'gy903.workspace-session-manager') }
};

const kw = (process.argv[2] || 'Code').toLowerCase();

(async () => {
    const { items } = store.scan(context);
    const w = items.find((i) => (i.folderPath || i.label || '').toLowerCase().includes(kw));
    if (!w) {
        console.log('找不到匹配的工作区。可选：');
        for (const i of items) console.log('  -', i.label, '|', i.folderPath || '');
        return;
    }

    await store.ensureIndex(w);
    const v = store.visibility(w);
    store.computeSize(w);

    console.log(`工作区：${w.folderPath || w.label}`);
    console.log(`存储：${w.dir}`);
    console.log(`体积：${fmtSize(w.size)}　最后使用：${fmtDate(w.mtime)}`);
    console.log('');
    console.log(`索引条目 ${v.indexed}　JSONL ${v.jsonl}　可见 ${v.visible}　孤儿 ${v.orphan}　幽灵 ${v.ghost}`);

    const sess = store.loadSessions(w);
    const orphans = sess.filter((s) => s.orphan === true);
    const idxEntries = w._index.raw.entries;
    const jsonlIds = new Set(sess.map((s) => s.id));
    const ghosts = Object.keys(idxEntries).filter((id) => !jsonlIds.has(id));

    // ---- 孤儿 ----
    console.log('');
    console.log(`━━━ 孤儿 ${orphans.length} 条（JSONL 在磁盘上，索引里没有 → 面板看不到）━━━`);
    let orphanBytes = 0;
    for (const s of orphans) {
        let b = 0;
        try { b = require('fs').statSync(s.file).size; } catch { /* ignore */ }
        orphanBytes += b;
        console.log(`  ${fmtDate(s.created).padEnd(11)} ${String(s.title || '(无标题)').slice(0, 52).padEnd(54)} ${fmtSize(b).padStart(8)}  ${s.id.slice(0, 8)}`);
    }
    console.log(`  —— 合计 ${fmtSize(orphanBytes)}`);

    // ---- 幽灵 ----
    console.log('');
    console.log(`━━━ 幽灵 ${ghosts.length} 条（索引里有、文件已不存在 → 面板里是空白项）━━━`);
    for (const id of ghosts) {
        const e = idxEntries[id] || {};
        const d = e.lastMessageDate || (e.timing && e.timing.created);
        console.log(`  ${fmtDate(d).padEnd(11)} ${String(e.title || '(无标题)').slice(0, 52).padEnd(54)} ${id.slice(0, 8)}`);
    }

    // ---- 按月分布（看是不是某次操作批量造成）----
    const byMonth = {};
    for (const s of orphans) {
        const k = s.created ? new Date(s.created).toISOString().slice(0, 7) : '未知';
        byMonth[k] = (byMonth[k] || 0) + 1;
    }
    console.log('');
    console.log('孤儿按月分布：', Object.entries(byMonth).sort().map(([k, n]) => `${k}:${n}`).join('  '));

    const byMonthG = {};
    for (const id of ghosts) {
        const e = idxEntries[id] || {};
        const d = e.lastMessageDate || (e.timing && e.timing.created);
        const k = d ? new Date(d).toISOString().slice(0, 7) : '未知';
        byMonthG[k] = (byMonthG[k] || 0) + 1;
    }
    console.log('幽灵按月分布：', Object.entries(byMonthG).sort().map(([k, n]) => `${k}:${n}`).join('  '));
})();
