// 分析单个 session JSONL 的体积构成：行数 / kind 分布 / 最大的行
const fs = require('fs');
const readline = require('readline');
const path = require('path');

const file = process.argv[2];
if (!file) {
  console.error('用法: node test/bigfile.js <xxx.jsonl>');
  process.exit(1);
}

const sizeMB = fs.statSync(file).size / 1048576;
console.log('文件:', path.basename(file));
console.log('大小:', sizeMB.toFixed(1), 'MB');

let lines = 0;
let total = 0;
const kinds = {};
const top = [];

const rl = readline.createInterface({ input: fs.createReadStream(file) });
rl.on('line', (l) => {
  lines++;
  const b = Buffer.byteLength(l);
  total += b;
  const m = l.match(/^\{"kind":(\d+)/);
  const k = m ? 'kind' + m[1] : 'other';
  kinds[k] = (kinds[k] || 0) + 1;
  if (top.length < 6 || b > top[top.length - 1].s) {
    top.push({ s: b, k, head: l.slice(0, 200) });
    top.sort((a, x) => x.s - a.s);
    if (top.length > 6) top.length = 6;
  }
});
rl.on('close', () => {
  console.log('行数:', lines, ' 累计:', (total / 1048576).toFixed(1), 'MB');
  console.log('kind 分布:', JSON.stringify(kinds));
  console.log('--- 最大的 6 行 ---');
  top.forEach((t) => {
    console.log((t.s / 1048576).toFixed(2) + ' MB  ' + t.k + '  ' + t.head.replace(/\s+/g, ' ').slice(0, 150));
  });
});
