const path = require('path');
const fs = require('fs');
const sqlite = require('../src/sqlite');
const pending = require('../src/pending');

(async () => {
    console.log('队列目录存在:', fs.existsSync(pending.queueDir()));
    console.log('队列文件存在:', fs.existsSync(pending.queuePath()));
    console.log('自动执行日志存在:', fs.existsSync(pending.autoLogPath()));

    const dir = path.join(process.env.APPDATA, 'Code', 'User', 'workspaceStorage', 'a6310449149df37de9ad8eeb066cbb7a');
    const r = await sqlite.readIndex(path.join(dir, 'state.vscdb'));
    console.log('\n索引读取 ok =', r.ok, r.error || '');
    if (!r.ok) return;
    const e = r.index.entries || {};
    console.log('条目总数', Object.keys(e).length);
    for (const id of ['c019911a-c41d-444d-83a2-a294d654be1a', 'a1f5de1e-cde4-492e-99d4-db32f34ae378', '56a62496-630c-49c0-92b9-063965bd9a0d']) {
        const v = e[id];
        console.log(`  ${id.slice(0, 8)} → ${v ? JSON.stringify({ title: v.title, isEmpty: v.isEmpty, isExternal: v.isExternal, loc: v.initialLocation }) : '(不在索引里)'}`);
    }
})();
