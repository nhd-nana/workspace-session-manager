const fs = require('fs');
const pkgPath = 'package.json';
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const dropCommands = [
    'wsManager.dropPending',
    'wsManager.clearPending',
    'wsManager.showAutoLog',
    'wsManager.installAutoTask',
    'wsManager.uninstallAutoTask',
    'wsManager.taskStatus'
];

pkg.contributes.commands = pkg.contributes.commands.filter((c) => !dropCommands.includes(c.command));

const m = pkg.contributes.menus;
if (m['view/item/context']) {
    m['view/item/context'] = m['view/item/context'].filter((x) => !dropCommands.includes(x.command));
}
if (m.commandPalette) {
    m.commandPalette = m.commandPalette.filter((x) => !dropCommands.includes(x.command));
}
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

// 清掉 nls 里对应的占位符
for (const f of ['package.nls.json', 'package.nls.zh-cn.json']) {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    for (const k of ['command.dropPending', 'command.clearPending', 'command.showAutoLog', 'command.installAutoTask', 'command.uninstallAutoTask', 'command.taskStatus', 'config.pendingQueue']) {
        delete j[k];
    }
    fs.writeFileSync(f, JSON.stringify(j, null, 4) + '\n', 'utf8');
}

console.log('commands:', pkg.contributes.commands.length);
console.log('item/context:', m['view/item/context'].length, 'commandPalette:', m.commandPalette.length);
