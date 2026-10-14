// 干跑 + 模拟写入：验证补索引逻辑，全程不碰真实 state.vscdb
require('./stub').install();
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../src/store');
const repair = require('../src/repair');
const sqlite = require('../src/sqlite');

const u = path.join(process.env.APPDATA, 'Code', 'User');
const hash = process.argv[2] || (process.env.WSM_HASH || '');
const ctx = {
    globalStorageUri: { fsPath: path.join(u, 'globalStorage', 'probe') },
    storageUri: { fsPath: path.join(u, 'workspaceStorage', hash, 'g') },
};
const mb = (n) => (n / 1048576).toFixed(1) + ' MB';
const fmt = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '?');

(async () => {
    const { items } = store.scan(ctx);
    const w = items.find((i) => i.hash === hash) || items.find((i) => i.isCurrent);
    console.log('工作区:', w.label, '|', w.hash, '| isCurrent =', w.isCurrent);

    const p = await repair.plan(w);
    if (!p.ok) return console.log('plan 失败:', p.error);

    console.log(`\n索引 ${Object.keys(p.entries).length} 条（本地 ${Object.keys(p.entries).length - p.external.length} / 外部 ${p.external.length}）`);
    console.log(`文件 ${p.files.length} 个`);
    console.log(`  可见   ${p.visible.length}`);
    console.log(`  孤儿   ${p.orphan.length}`);
    console.log(`  幽灵   ${p.ghost.length}`);
    console.log(`  外部   ${p.external.length}  (永不清理)`);

    console.log(`\n=== 计划补进索引 (${p.toAdd.length} 条, ${mb(p.bytesAdded)}) ===`);
    for (const f of p.toAdd.slice(0, 12)) {
        const meta = store.readSessionMeta(f.file);
        console.log(`  ${fmt(f.mtime)}  ${String(Math.round(f.size / 1024)).padStart(6)} KB  ${meta.title || '(无标题)'}`);
    }
    if (p.toAdd.length > 12) console.log(`  ... 其余 ${p.toAdd.length - 12} 条`);

    console.log(`\n=== 跳过（空壳 < ${p.minBytes}B, ${p.skipped.length} 条, ${mb(p.bytesSkipped)}）===`);
    for (const f of p.skipped.slice(0, 5)) console.log(`  ${fmt(f.mtime)}  ${f.size} B  ${f.id}`);
    if (p.skipped.length > 5) console.log(`  ... 其余 ${p.skipped.length - 5} 条`);

    console.log(`\n=== 计划清除的幽灵条目 (${p.toRemove.length}) ===`);
    for (const id of p.toRemove) {
        const e = p.entries[id];
        console.log(`  ${fmt(e && e.lastMessageDate)}  isEmpty=${e && e.isEmpty}  ${id}`);
    }

    // ── 模拟写入：对 state.vscdb 的副本执行 ─────────────────────────
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wsmgr-sim-'));
    fs.copyFileSync(path.join(w.dir, 'state.vscdb'), path.join(tmp, 'state.vscdb'));
    console.log('\n=== 模拟写入（副本目录 ' + tmp + '）===');

    const simEntry = { dir: tmp, isCurrent: false };
    const r = await repair.apply(simEntry, p, { backup: true });
    console.log('apply →', JSON.stringify(r));

    const after = await sqlite.readIndex(path.join(tmp, 'state.vscdb'));
    if (after.ok) {
        const ids = Object.keys(after.index.entries);
        const local = ids.filter((x) => !repair.isExternalId(x));
        console.log(`写回后：条目 ${ids.length}（本地 ${local.length} / 外部 ${ids.length - local.length}）`);
        const sample = p.toAdd[0];
        if (sample) {
            const e = after.index.entries[sample.id];
            console.log('抽样条目:', sample.id, '→', e ? '✅ 已在索引中' : '❌ 缺失');
            if (e) console.log('  ', JSON.stringify(e).slice(0, 300));
        }
        console.log('外部会话是否被误删:', p.external.every((x) => after.index.entries[x]) ? '✅ 全部保留' : '❌ 有丢失');
    } else {
        console.log('读回失败:', after.error);
    }

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('临时目录已清理');
})();
