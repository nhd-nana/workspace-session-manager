// 一次性工具：把 package.json 里面向用户的文案换成 %key% 占位符，并校验 nls 覆盖完整。
// 用法: node _tmp/l10n.js
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

// 1) 顶层文案
pkg.displayName = '%displayName%';
pkg.description = '%description%';

// 2) 视图名与设置页标题
pkg.contributes.views.explorer[0].name = '%view.workspaces%';
pkg.contributes.configuration.title = '%config.title%';

// 3) 配置项描述
for (const key of Object.keys(pkg.contributes.configuration.properties)) {
    pkg.contributes.configuration.properties[key].description =
        '%config.' + key.replace('wsManager.', '') + '%';
}

// 4) 命令标题 + 命令分类
for (const command of pkg.contributes.commands) {
    command.title = '%command.' + command.command.replace('wsManager.', '') + '%';
    command.category = '%category%';
}

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

// 5) 校验：用到的每个 %key% 都要在两个 nls 里存在，且不应有未使用的键
const en = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.json'), 'utf8'));
const zh = JSON.parse(fs.readFileSync(path.join(root, 'package.nls.zh-cn.json'), 'utf8'));
const raw = fs.readFileSync(pkgPath, 'utf8');
const used = Array.from(new Set(Array.from(raw.matchAll(/%([A-Za-z0-9_.]+)%/g)).map((m) => m[1])));

const miss = (nls) => used.filter((k) => !(k in nls));
const extra = (nls) => Object.keys(nls).filter((k) => used.indexOf(k) < 0);

console.log('配置项:', Object.keys(pkg.contributes.configuration.properties).length,
    '| 命令:', pkg.contributes.commands.length,
    '| 使用占位符:', used.length);
console.log('英文缺失:', miss(en));
console.log('中文缺失:', miss(zh));
console.log('未使用的键(en):', extra(en));
console.log('未使用的键(zh):', extra(zh));
console.log('en/zh key 差异:', Object.keys(en).filter((k) => !(k in zh)), Object.keys(zh).filter((k) => !(k in en)));
