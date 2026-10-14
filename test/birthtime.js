// 用 birthtime(NTFS 创建时间) 区分：文件本来就在原地，还是后来被复制进来
require('./stub').install();
const fs = require('fs');
const path = require('path');
const store = require('../src/store');

const u = path.join(process.env.APPDATA, 'Code', 'User');
const ctx = {
    globalStorageUri: { fsPath: path.join(u, 'globalStorage', 'probe') },
    storageUri: {
        fsPath: path.join(u, 'workspaceStorage', process.argv[2] || (process.env.WSM_HASH || ''), 'g'),
    },
};
const d = (ms) => new Date(ms).toISOString().slice(0, 10);
const bucket = (arr) => {
    const m = {};
    for (const t of arr) m[d(t)] = (m[d(t)] || 0) + 1;
    return Object.entries(m).sort().map(([k, v]) => `    ${k}  ×${v}`).join('\n');
};

(async () => {
    const { items } = store.scan(ctx);
    const w = items.find((i) => i.isCurrent) || items[0];
    await store.ensureIndex(w);
    const entries = w._index.raw ? w._index.raw.entries : {};
    const indexed = new Set(Object.keys(entries).filter((i) => !i.startsWith('agent-host')));

    const files = w.sessionFiles.map((f) => {
        const st = fs.statSync(f);
        return { id: path.basename(f, '.jsonl'), bt: st.birthtimeMs, mt: st.mtimeMs };
    });
    const both = files.filter((f) => indexed.has(f.id));
    const orphan = files.filter((f) => !indexed.has(f.id));

    console.log('=== 可见会话  birthtime 分布 (' + both.length + ') ===');
    console.log(bucket(both.map((f) => f.bt)));
    console.log('\n=== 孤儿会话  birthtime 分布 (' + orphan.length + ') ===');
    console.log(bucket(orphan.map((f) => f.bt)));

    const csDir = path.join(w.dir, 'chatSessions');
    const dst = fs.statSync(csDir);
    console.log('\nchatSessions 目录  birthtime=', new Date(dst.birthtimeMs).toISOString().slice(0, 19));

    // birthtime 与 mtime 的时间差（>1 天 说明文件是后来被放入的）
    const gap = (f) => Math.abs(f.bt - f.mt) / 86400000;
    const gapped = orphan.filter((f) => gap(f) > 1);
    console.log('\n孤儿中 birthtime 与 mtime 相差 >1 天的:', gapped.length, '/', orphan.length);
    console.log(
        '  bt≈mt (原地未动) 的孤儿:',
        orphan.filter((f) => gap(f) <= 1).length
    );
})();
