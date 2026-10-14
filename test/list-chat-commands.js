// 枚举 bundle 里所有 chat 相关命令 ID，找有没有「重载/重置索引」这类入口
const fs = require('fs');
const s = fs.readFileSync(process.argv[2], 'utf8');

const pats = [
  /"(workbench\.action\.chat\.[A-Za-z0-9_.]+)"/g,
  /"(workbench\.action\.reload[A-Za-z0-9_.]*)"/g,
  /"(workbench\.action\.chat\.[A-Za-z0-9_.]*[Rr]efresh[A-Za-z0-9_.]*)"/g
];

for (const re of pats) {
  const set = new Set();
  let m;
  while ((m = re.exec(s)) !== null) set.add(m[1]);
  const list = [...set].sort();
  console.log(`\n===== ${re.source.slice(2, 40)}… → ${list.length} 个 =====`);
  for (const x of list) console.log('  ' + x);
}
