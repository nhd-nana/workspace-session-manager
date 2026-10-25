const sqlite = require('../src/sqlite');
const path = require('path');

(async () => {
    const dir = path.join(process.env.APPDATA, 'Code', 'User', 'workspaceStorage', 'a6310449149df37de9ad8eeb066cbb7a');
    const r = await sqlite.readIndex(path.join(dir, 'state.vscdb'));
    if (!r.ok) { console.log('读索引失败:', r.error); return; }
    const e = r.index.entries || {};
    const hits = Object.entries(e).filter(([id, v]) => id.startsWith('a1f5de1e') || /1\.142|抢跑/.test(v.title || ''));
    console.log('条目总数', Object.keys(e).length);
    for (const [id, v] of hits) {
        console.log(`  ${id}`);
        console.log(`    title    = ${JSON.stringify(v.title)}`);
        console.log(`    isEmpty  = ${v.isEmpty}  isExternal=${v.isExternal}  initialLocation=${v.initialLocation}`);
    }
})();
