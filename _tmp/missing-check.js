const path = require('path');
const fs = require('fs');
const sqlite = require('../src/sqlite');

(async () => {
    const dir = path.join(process.env.APPDATA, 'Code', 'User', 'workspaceStorage', 'a6310449149df37de9ad8eeb066cbb7a');
    const sess = path.join(dir, 'chatSessions');
    const files = fs.readdirSync(sess).filter((n) => n.endsWith('.jsonl'));
    const r = await sqlite.readIndex(path.join(dir, 'state.vscdb'));
    const idx = r.ok ? r.index.entries || {} : {};
    const ids = new Set(Object.keys(idx));

    const missing = files.filter((n) => !ids.has(n.replace(/\.jsonl$/, '')));
    const ghosts = [...ids].filter((id) => !files.includes(id + '.jsonl'));

    console.log(`文件 ${files.length} 个｜索引 ${ids.size} 条`);
    console.log(`文件有但索引没有（孤儿，面板不显示）: ${missing.length}`);
    for (const n of missing.slice(0, 10)) {
        const p = path.join(sess, n);
        console.log(`  ${n.slice(0, 8)}  ${(fs.statSync(p).size / 1024).toFixed(1)}KB  ${fs.statSync(p).mtime.toISOString().slice(0, 19)}`);
    }
    console.log(`索引有但文件没有（幽灵）: ${ghosts.length}`);
    for (const id of ghosts.slice(0, 10)) console.log(`  ${id.slice(0, 8)}  title=${JSON.stringify(idx[id].title)}`);

    // 最近 6 小时改过的会话文件，看它们在索引里的样子
    const cuts = Date.now() - 6 * 3600 * 1000;
    console.log('\n近 6 小时有改动的会话:');
    for (const n of files) {
        const p = path.join(sess, n);
        const st = fs.statSync(p);
        if (st.mtimeMs < cuts) continue;
        const id = n.replace(/\.jsonl$/, '');
        const v = idx[id];
        console.log(`  ${id.slice(0, 8)}  ${new Date(st.mtimeMs).toISOString().slice(11, 19)}  ${(st.size / 1024).toFixed(0)}KB  ${v ? `inIndex title=${JSON.stringify(v.title)} isEmpty=${v.isEmpty}` : '❌ 不在索引'}`);
    }
})();
