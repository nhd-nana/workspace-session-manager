import fs from 'fs';
import path from 'path';

const needle = process.argv[2] || 'VSCode 1.142';
const root = path.join(process.env.APPDATA || '', 'Code', 'User', 'workspaceStorage');

function firstLine(p, max = 400) {
    const fd = fs.openSync(p, 'r');
    try {
        const b = Buffer.alloc(max);
        const n = fs.readSync(fd, b, 0, max, 0);
        const s = b.toString('utf8', 0, n);
        const i = s.indexOf('\n');
        return i >= 0 ? s.slice(0, i) : s;
    } finally { fs.closeSync(fd); }
}

function tailDeltas(p) {
    const st = fs.statSync(p);
    const start = Math.max(0, st.size - (1 << 20));
    const fd = fs.openSync(p, 'r');
    try {
        const b = Buffer.alloc(st.size - start);
        fs.readSync(fd, b, 0, b.length, start);
        const text = b.toString('utf8');
        const re = /\{"kind":1,"k":\["customTitle"\],"v":("(?:[^"\\]|\\.)*")\}/g;
        const out = [];
        let m;
        while ((m = re.exec(text)) !== null) out.push(m[1]);
        return out;
    } finally { fs.closeSync(fd); }
}

for (const h of fs.readdirSync(root)) {
    const dir = path.join(root, h, 'chatSessions');
    if (!fs.existsSync(dir)) continue;
    for (const n of fs.readdirSync(dir)) {
        if (!n.endsWith('.jsonl')) continue;
        const p = path.join(dir, n);
        const size = fs.statSync(p).size;
        let hit = false;
        // 只扫前 200KB 找标题（标题在 header 或索引里；这里扫全文太慢，用尾部+头部）
        const head = (() => { const fd = fs.openSync(p, 'r'); try { const b = Buffer.alloc(Math.min(size, 200 * 1024)); fs.readSync(fd, b, 0, b.length, 0); return b.toString('utf8'); } finally { fs.closeSync(fd); } })();
        if (head.includes(needle)) hit = true;
        if (!hit) continue;
        const fl = firstLine(p);
        const lines = (() => { const fd = fs.openSync(p, 'r'); try { const b = Buffer.alloc(Math.min(size, 200 * 1024)); fs.readSync(fd, b, 0, b.length, 0); return b.toString('utf8').split('\n').length; } finally { fs.closeSync(fd); } })();
        console.log(`\n== ${h.slice(0, 8)}/${n.slice(0, 8)}  ${(size / 1024).toFixed(1)} KB`);
        console.log(`   header 开头: ${JSON.stringify(fl.slice(0, 90))}`);
        console.log(`   格式: ${fl.startsWith('{"kind":0') ? 'log（多行）' : '⚠️ 紧凑（单行）'}`);
        console.log(`   头部 200KB 行数: ${lines}`);
        console.log(`   尾部 customTitle delta: ${JSON.stringify(tailDeltas(p).slice(-4))}`);
    }
}
