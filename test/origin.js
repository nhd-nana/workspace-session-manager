// 从每个 session JSONL 的首部提取 workingDirectory，判断它原本属于哪个工作区
const fs = require('fs');
const path = require('path');

const csDir = path.join(
    process.env.APPDATA,
    'Code',
    'User',
    'workspaceStorage',
    process.argv[2] || (process.env.WSM_HASH || ''),
    'chatSessions'
);
const only = process.argv[3]; // 'orphan' 只列孤儿 / 'all'

const files = fs.readdirSync(csDir).filter((n) => n.endsWith('.jsonl'));

// 索引（可选，用来区分孤儿）
let indexed = null;
try {
    require('./stub').install();
    const store = require('../src/store');
    const u = path.join(process.env.APPDATA, 'Code', 'User');
    indexed = null; // 由调用方决定
} catch (e) { }

const HEAD = 512 * 1024;

function probe(file) {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.allocUnsafe(HEAD);
    const n = fs.readSync(fd, buf, 0, HEAD, 0);
    fs.closeSync(fd);
    const s = buf.toString('utf8', 0, n);
    const get = (re) => {
        const m = s.match(re);
        return m ? m[1] : null;
    };
    return {
        wd: get(/"workingDirectory":"((?:[^"\\]|\\.)*)"/),
        wd2: get(/"workingDirectory":\{"path":"((?:[^"\\]|\\.)*)"/),
        created: get(/"creationDate":(\d+)/),
        size: fs.statSync(file).size,
    };
}

const map = {};
for (const f of files) {
    const full = path.join(csDir, f);
    let r;
    try {
        r = probe(full);
    } catch (e) {
        r = { wd: null, wd2: null, created: null, size: 0, err: e.message };
    }
    let dir = r.wd || r.wd2;
    if (dir) {
        dir = dir.replace(/\\\\/g, '\\').replace(/^\/([a-z])\//i, '$1:\\').replace(/\//g, '\\');
    }
    const key = dir || '(无 workingDirectory 字段)';
    if (!map[key]) map[key] = [];
    map[key].push({ id: f.slice(0, -6), size: r.size, created: r.created });
}

console.log('共扫描', files.length, '个 JSONL\n');
const rows = Object.entries(map).sort((a, b) => b[1].length - a[1].length);
for (const [dir, arr] of rows) {
    const total = arr.reduce((a, b) => a + b.size, 0);
    const dates = arr
        .map((x) => (x.created ? new Date(+x.created).toISOString().slice(0, 10) : '?'))
        .sort();
    console.log(
        `${String(arr.length).padStart(3)} 条  ${(total / 1048576).toFixed(1).padStart(8)} MB   ${dates[0]} ~ ${dates[dates.length - 1]}\n      ${dir}`
    );
}
