const path = require('path');
const sqlite = require('../src/sqlite');
const live = require('../src/live');

(async () => {
    const dir = path.join(process.env.APPDATA, 'Code', 'User', 'workspaceStorage', 'a6310449149df37de9ad8eeb066cbb7a');
    const db = path.join(dir, 'state.vscdb');
    console.log('isDbOpen =', live.isDbOpen(db), '（应为 true）');
    const t0 = Date.now();
    const r = await sqlite.readIndex(db);
    console.log('读取结果 ok =', r.ok, r.error || '', `耗时 ${Date.now() - t0}ms`);
    if (r.ok) {
        const e = r.index.entries || {};
        for (const id of ['a1f5de1e-cde4-492e-99d4-db32f34ae378', '56a62496-630c-49c0-92b9-063965bd9a0d']) {
            console.log(`  ${id.slice(0, 8)} → ${e[id] ? JSON.stringify(e[id].title) : '(无)'}`);
        }
    }
})();
