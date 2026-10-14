// 在指定的 codicon css 里查图标名（接受文件路径参数，不做目录遍历）
const fs = require('fs');

const files = process.argv.slice(2);
const names = [
    'duplicate', 'copy', 'new-file', 'file-text', 'markdown', 'files', 'archive', 'wrench', 'history',
    'refresh', 'trash', 'globe', 'eye', 'list-ordered', 'question', 'warning', 'info', 'lock',
    'comment', 'comment-unresolved', 'comment-discussion', 'graph', 'list-tree', 'file-directory',
    'compare-changes', 'diff', 'versions', 'sync', 'check'
];

let text = '';
for (const f of files) {
    try {
        text += fs.readFileSync(f, 'utf8');
        console.log(`读了 ${f}（${fs.statSync(f).size} B）`);
    } catch (e) {
        console.log(`跳过 ${f}: ${e.message}`);
    }
}
console.log(`合计 ${text.length} 字符\n`);

for (const n of names) {
    const has = text.includes(`.codicon-${n}:before`);
    console.log(`  ${n.padEnd(18)} ${has ? '✅ 存在' : '❌ 不存在'}`);
}
