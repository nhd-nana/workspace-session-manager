// 检查 state.vscdb 及其所有备份里的索引：孤儿在这些快照中存在过吗？
require('./stub').install();
const fs = require('fs');
const path = require('path');
const sqlite = require('../src/sqlite');

const dir = path.join(
    process.env.APPDATA,
    'Code',
    'User',
    'workspaceStorage',
    process.argv[2] || (process.env.WSM_HASH || '')
);
const csDir = path.join(dir, 'chatSessions');

(async () => {
    const files = fs
        .readdirSync(csDir)
        .filter((n) => n.endsWith('.jsonl'))
        .map((n) => n.slice(0, -6));

    const snapshots = fs.readdirSync(dir).filter((n) => n.startsWith('state.vscdb'));
    let orphanIds = null;

    for (const name of snapshots) {
        const p = path.join(dir, name);
        const st = fs.statSync(p);
        const r = await sqlite.readIndex(p);
        const when = new Date(st.mtimeMs).toISOString().slice(0, 19);
        if (!r.ok) {
            console.log(`${name}  ${(st.size / 1048576).toFixed(2)}MB  ${when}  → 读取失败: ${r.error || r.code}`);
            continue;
        }
        const ids = Object.keys(r.index.entries || {});
        const local = ids.filter((i) => !i.startsWith('agent-host'));
        const ext = ids.length - local.length;

        const inDb = new Set(local);
        const missing = files.filter((f) => !inDb.has(f)); // 该快照下的孤儿

        console.log(
            `${name}  ${(st.size / 1048576).toFixed(2)}MB  ${when}\n` +
            `   条目 ${ids.length} (本地 ${local.length} / 外部 ${ext})  文件 ${files.length}  → 若用它: 孤儿 ${missing.length}`
        );
        if (orphanIds === null) orphanIds = new Set(missing);
        else {
            const recovered = missing.filter((m) => !orphanIds.has(m)).length;
            console.log(`   (相对主 db 多出可恢复的: ${recovered})`);
        }
    }
})();
