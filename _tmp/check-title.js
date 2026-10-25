// 临时：比对「索引里的 title」与「会话文件里的 customTitle」，看是否已经漂移
// 用法: node _tmp/check-title.js <state.vscdb> <chatSessions 目录>
const fs = require('fs');
const path = require('path');
const { readIndex } = require('../src/sqlite');

const [db, dir] = process.argv.slice(2);

function customTitleOf(file) {
    const text = fs.readFileSync(file, 'utf8');
    const m = /"customTitle"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(text);
    if (!m) return undefined;              // 键不出现
    try { return JSON.parse(m[1]); } catch { return undefined; }
}

readIndex(db).then((r) => {
    if (!r.ok) return console.log('ERR', r.error);
    const entries = r.index.entries;
    let same = 0;
    let diff = 0;
    let noKey = 0;
    const rows = [];
    for (const [id, e] of Object.entries(entries)) {
        const f = path.join(dir, id + '.jsonl');
        if (!fs.existsSync(f)) continue;
        if (fs.statSync(f).size > 5 * 1048576) continue;
        const ct = customTitleOf(f);
        if (ct === undefined) { noKey++; continue; }
        if (ct === e.title) { same++; continue; }
        diff++;
        rows.push(`  ✗ 索引: ${JSON.stringify(e.title)}\n    文件: ${JSON.stringify(ct)}   [${id.slice(0, 8)}]`);
    }
    console.log(`一致: ${same}   不一致: ${diff}   文件里没有该键: ${noKey}`);
    rows.slice(0, 12).forEach((x) => console.log(x));
});
