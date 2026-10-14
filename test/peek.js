// 从指定偏移处读一段原始内容（诊断巨型单行文件）
const fs = require('fs');

const file = process.argv[2];
const offset = Number(process.argv[3] || 0);
const len = Number(process.argv[4] || 800);

const fd = fs.openSync(file, 'r');
const buf = Buffer.alloc(len);
const n = fs.readSync(fd, buf, 0, len, offset);
fs.closeSync(fd);

console.log(`--- offset ${offset}  读到 ${n} 字节 ---`);
console.log(buf.toString('utf8', 0, n).replace(/\s+/g, ' '));
