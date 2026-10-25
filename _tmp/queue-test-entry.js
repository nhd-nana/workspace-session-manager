const pending = require('../src/pending');

const e = {
    file: String.raw`C:\Users\gy903\AppData\Roaming\Code\User\workspaceStorage\a6310449149df37de9ad8eeb066cbb7a\chatSessions\a1f5de1e-cde4-492e-99d4-db32f34ae378.jsonl`,
    id: 'a1f5de1e-cde4-492e-99d4-db32f34ae378',
    dir: String.raw`C:\Users\gy903\AppData\Roaming\Code\User\workspaceStorage\a6310449149df37de9ad8eeb066cbb7a`,
    title: '抢跑测试'
};
const n = pending.add(e);
console.log('队列条数:', n);
console.log(JSON.stringify(pending.load(), null, 2));
