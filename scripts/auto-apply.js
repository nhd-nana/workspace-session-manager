#!/usr/bin/env node
'use strict';
/**
 * auto-apply.js —— 计划任务调用的入口。**没有队列就立刻退出。**
 *
 * 设计约束（用户明确要求：可监督、不烦人）：
 *   · 不弹窗、不开终端窗口（由计划任务以隐藏方式运行）
 *   · 不常驻：跑完立刻退出，系统里不残留进程
 *   · 有 Code.exe 在跑 → 直接退出（此时写索引会撞锁，导致 VS Code 闪退）
 *   · 只处理队列里用户看得见、可删除的条目
 *   · 每次运行追加一行日志到 <队列目录>\auto-apply.log
 *
 * 手动试跑（不写任何东西）：
 *   node scripts/auto-apply.js --dry
 */
const fs = require('fs');
const { execSync } = require('child_process');
const pending = require('../src/pending');

const dry = process.argv.includes('--dry');

function log(msg) {
    const line = `[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] ${msg}`;
    try {
        fs.mkdirSync(pending.queueDir(), { recursive: true });
        fs.appendFileSync(pending.autoLogPath(), line + '\n', 'utf8');
    } catch { /* ignore */ }
    if (dry) console.log(line);
}

function codeRunning() {
    try {
        const r = execSync('tasklist /nh /fo csv /fi "IMAGENAME eq Code.exe"', {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        });
        return r.trim().toLowerCase().startsWith('"code.exe"');
    } catch { return false; }
}

(async () => {
    const q = pending.load();
    if (!q.length) { if (dry) log('队列为空，退出'); return; }

    if (codeRunning()) { log(`队列 ${q.length} 条，但 Code.exe 仍在运行 → 跳过`); return; }

    log(`开始：队列 ${q.length} 条`);
    const r = await pending.applyAll({ repairIndex: true });
    log(`完成：写入 ${r.applied.length}｜确认 ${r.confirmed.length}｜作废 ${r.dropped.length}｜失败 ${r.failed.length}｜索引未修 ${r.indexPending.length}｜剩余 ${r.remaining}`);
    for (const x of r.failed) log(`  失败 ${x.e && x.e.file} — ${x.reason}`);
    for (const x of r.dropped) log(`  作废 ${x.e && x.e.file} — ${x.reason || ''}`);
})().catch((e) => log('异常: ' + ((e && e.stack) || e)));
