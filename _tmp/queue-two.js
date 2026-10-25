const path = require('path');
const pending = require('../src/pending');

const dir = path.join(process.env.APPDATA, 'Code', 'User', 'workspaceStorage', 'a6310449149df37de9ad8eeb066cbb7a');
const sess = path.join(dir, 'chatSessions');

pending.add({ file: path.join(sess, 'a1f5de1e-cde4-492e-99d4-db32f34ae378.jsonl'), id: 'a1f5de1e-cde4-492e-99d4-db32f34ae378', dir, title: '抢跑测试' });
pending.add({ file: path.join(sess, '56a62496-6f00-4e17-9f0c-4a6d1b3f2a11.jsonl'), id: '', dir, title: '抢跑测试2' });

// 56a62496 的真实 id 从文件名取，避免上面写错
const fs = require('fs');
const real = fs.readdirSync(sess).find((n) => n.startsWith('56a62496'));
const list = pending.load().map((e) => (e.title === '抢跑测试2' && real
    ? { ...e, id: real.replace(/\.jsonl$/, ''), file: path.join(sess, real) }
    : e));
pending.save(list);
console.log(JSON.stringify(pending.load(), null, 2));
