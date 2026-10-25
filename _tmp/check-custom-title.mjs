import fs from 'fs';
import path from 'path';

const root = path.join(process.env.APPDATA || '', 'Code', 'User', 'workspaceStorage');
const cuts = Date.now() - 3 * 86400000;

/** 逐行取：header 里的 customTitle，以及所有 k=["customTitle"] 增量的 v（末条为准） */
function scan(p) {
    const fd = fs.openSync(p, 'r');
    const chunk = Buffer.allocUnsafe(1 << 20);
    let carry = '';
    const deltas = [];
    let headerTitle = null;
    let n;
    while ((n = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) {
        const text = carry + chunk.toString('utf8', 0, n);
        let start = 0;
        let i;
        while ((i = text.indexOf('\n', start)) >= 0) {
            const line = text.slice(start, i);
            start = i + 1;
            if (line.indexOf('customTitle') < 0) continue;
            const d = /\{"kind":1,"k":\["customTitle"\],"v":("(?:[^"\\]|\\.)*"|null)\}/.exec(line);
            if (d) { deltas.push(d[1]); continue; }
            const h = /"customTitle":("(?:[^"\\]|\\.)*")/.exec(line);
            if (h && headerTitle === null) headerTitle = h[1];
        }
        carry = text.slice(start);
    }
    fs.closeSync(fd);
    return { headerTitle, deltas };
}

const rows = [];
let total = 0;
for (const h of fs.readdirSync(root)) {
    const dir = path.join(root, h, 'chatSessions');
    if (!fs.existsSync(dir)) continue;
    for (const nm of fs.readdirSync(dir)) {
        if (!nm.endsWith('.jsonl')) continue;
        total++;
        const p = path.join(dir, nm);
        const st = fs.statSync(p);
        if (st.mtimeMs < cuts) continue;
        const r = scan(p);
        if (r.headerTitle === null && !r.deltas.length) continue;
        rows.push({ p, mtime: new Date(st.mtimeMs).toISOString().slice(0, 19), ...r });
    }
}

console.log(`总 ${total} 个会话文件；近 3 天且带 customTitle 的 ${rows.length} 个：`);
for (const r of rows.sort((a, b) => (a.mtime < b.mtime ? 1 : -1))) {
    console.log(`\n  ${r.mtime}  ${path.basename(path.dirname(path.dirname(r.p))).slice(0, 8)}/${path.basename(r.p, '.jsonl').slice(0, 8)}`);
    console.log(`    header : ${r.headerTitle === null ? '(无)' : r.headerTitle}`);
    console.log(`    deltas : ${r.deltas.length ? r.deltas.map((d) => (d === null ? 'null' : d)).join('  <-  ') : '(无)'}`);
}
