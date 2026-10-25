// 校验：src/*.js 里每个 t('...') 的英文原文，都必须在中英 bundle 里有对应条目
// 用法（在项目根）: node scripts/dev/check-l10n.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', '..');
const srcDir = path.join(root, 'src');
const bundlePath = path.join(root, 'l10n', 'bundle.l10n.zh-cn.json');

const bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8'));
const re = /\bt\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;

const used = new Map(); // key -> [files]
for (const name of fs.readdirSync(srcDir)) {
    if (!name.endsWith('.js') || name === 'l10n.js') continue;
    const text = fs.readFileSync(path.join(srcDir, name), 'utf8');
    let m;
    while ((m = re.exec(text)) !== null) {
        let key;
        try {
            key = new Function('return ' + m[1])();
        } catch {
            console.log(`⚠️ 无法解析字面量 ${name}: ${m[1]}`);
            continue;
        }
        if (!used.has(key)) used.set(key, []);
        if (!used.get(key).includes(name)) used.get(key).push(name);
    }
}

const missing = [...used.keys()].filter((k) => !(k in bundle));
const unused = Object.keys(bundle).filter((k) => !used.has(k));

console.log(`源码里的 t() 文案: ${used.size} 条`);
console.log(`bundle 条目      : ${Object.keys(bundle).length} 条`);
console.log(`中文缺失 (${missing.length}):`);
for (const k of missing) console.log(`   [${used.get(k).join(',')}] ${JSON.stringify(k)}`);
console.log(`bundle 里多余的键 (${unused.length}):`);
for (const k of unused) console.log(`   ${JSON.stringify(k)}`);
process.exit(missing.length ? 1 : 0);
