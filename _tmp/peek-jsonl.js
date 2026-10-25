// 临时：看清 .jsonl 会话文件的结构，尤其 customTitle 出现在哪一行、哪种记录里
// 用法: node _tmp/peek-jsonl.js <某个 .jsonl>
const fs = require('fs');

const file = process.argv[2];
const text = fs.readFileSync(file, 'utf8');
const lines = text.split('\n').filter((l) => l.length > 0);

console.log(`文件: ${file.split(/[\\/]/).pop()}   size=${fs.statSync(file).size} B   行数=${lines.length}`);
for (let i = 0; i < Math.min(lines.length, 4); i++) {
    const l = lines[i];
    console.log(`  [${i}] len=${l.length}  ${l.slice(0, 160)}`);
}
console.log('--- 含 customTitle 的行 ---');
lines.forEach((l, i) => {
    const at = l.indexOf('"customTitle"');
    if (at >= 0) {
        console.log(`  [${i}] len=${l.length}  ...${l.slice(Math.max(0, at - 120), at + 120)}...`);
    }
});
