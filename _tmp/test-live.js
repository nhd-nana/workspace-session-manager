const path = require('path');
const live = require('../src/live');

const base = path.join(process.env.APPDATA, 'Code', 'User', 'workspaceStorage');
console.log('打开的窗口目标:');
for (const t of live.openTargets()) console.log('  ' + t);

for (const h of ['a6310449149df37de9ad8eeb066cbb7a', '1c73ebe047b5a98af727751fab1445e2']) {
    const dir = path.join(base, h);
    const t = live.targetOfDir(dir);
    console.log(`\n${h.slice(0, 8)}  target=${t}`);
    console.log(`  isDbOpen = ${live.isDbOpen(path.join(dir, 'state.vscdb'))}`);
}
