const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const en = JSON.parse(fs.readFileSync('package.nls.json', 'utf8'));
const zh = JSON.parse(fs.readFileSync('package.nls.zh-cn.json', 'utf8'));

const used = new Set();
const walk = (o) => {
    if (typeof o === 'string') {
        for (const m of o.matchAll(/%([A-Za-z0-9_.\-]+)%/g)) used.add(m[1]);
    } else if (o && typeof o === 'object') {
        for (const v of Object.values(o)) walk(v);
    }
};
walk(pkg);

const missEn = [...used].filter((k) => !(k in en));
const missZh = [...used].filter((k) => !(k in zh));
const extraEn = Object.keys(en).filter((k) => !used.has(k));
const extraZh = Object.keys(zh).filter((k) => !used.has(k));

console.log(`命令数 ${(pkg.contributes.commands || []).length}｜占位符 ${used.size}`);
console.log(`英文缺失 ${JSON.stringify(missEn)}`);
console.log(`中文缺失 ${JSON.stringify(missZh)}`);
console.log(`英文多余 ${JSON.stringify(extraEn)}`);
console.log(`中文多余 ${JSON.stringify(extraZh)}`);
