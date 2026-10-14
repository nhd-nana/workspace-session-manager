// 轻量解剖：只读文件头部 N MB，统计 kind 分布与行长（避开超长行导致的 OOM）
const fs = require('fs');

const file = process.argv[2];
const limit = Number(process.env.HEAD_MB || 2) * 1048576;

const st = fs.statSync(file);
const len = Math.min(st.size, limit);
const fd = fs.openSync(file, 'r');
const buf = Buffer.alloc(len);
fs.readSync(fd, buf, 0, len, 0);
fs.closeSync(fd);

const text = buf.toString('utf8');
const lines = text.split('\n');
const partial = lines.pop();               // 最后一截可能不完整

console.log(`文件 ${(st.size / 1048576).toFixed(1)} MB —— 本次只读了前 ${(len / 1048576).toFixed(1)} MB`);
console.log(`其中完整行 ${lines.length} 行（末尾还有一截未结束：${partial.length} 字符）`);

const kinds = {};
let total = 0;
const big = [];
lines.forEach((l, i) => {
  const b = Buffer.byteLength(l);
  total += b;
  const m = /^\{"kind":(\d+)/.exec(l);
  const k = m ? 'kind' + m[1] : 'other';
  kinds[k] = (kinds[k] || 0) + 1;
  if (i < 10 || b > 65536) big.push({ i, b, head: l.slice(0, 120).replace(/\s+/g, ' ') });
});

console.log('kind 分布:', JSON.stringify(kinds));
console.log(`平均行长: ${(total / Math.max(1, lines.length) / 1024).toFixed(0)} KB`);

console.log('\n--- 前 10 行 + 所有 >64KB 的行 ---');
big.slice(0, 18).forEach((h) => {
  console.log(`  #${h.i}  ${(h.b / 1048576).toFixed(2)} MB  ${h.head.slice(0, 100)}`);
});
