#!/usr/bin/env node
'use strict';
/**
 * reset-title-strategy.js —— 让「已有」的 agent-host 会话重新跟随标题生成策略。
 *
 * 背景：`chat.agentHost.experimental.titleGeneration` 只对**新会话**生效。
 * 官方描述原话：Changes apply to new sessions; existing sessions and their chats retain their strategy.
 * 原因：每个会话把当时那份策略存进了自己 session.db 的
 *       `session_metadata.titleGenerationStrategy`，之后一直按那份走。
 *       （agentSessionData/<uuid>/session.db）
 *
 * 取值：
 *   utility       只用工具模型生成，agent 不插手           ← 最不容易「被改名」的
 *   activeAgent   agent 通过 rename_chat 自己命名，且被要求「别让用户知道」
 *   agentReview   后台生成 + 之后提醒 agent 可以改名
 *   deferred      agentReview 的旧名（无提醒），老会话可能存的是这个
 *
 * 用法（默认只体检，不写任何东西）：
 *   node scripts/reset-title-strategy.js
 *   node scripts/reset-title-strategy.js --apply
 *   node scripts/reset-title-strategy.js --apply --value activeAgent
 *   node scripts/reset-title-strategy.js --apply --delete      # 删掉该行 → 回退到代码默认 utility
 *
 * 安全：
 *   · 检测到 Code.exe 在跑 → 默认拒绝（--force 可跳过，但 agent host 内存里缓存着策略，
 *     不彻底退出很可能改了也白改）
 *   · 只动 session_metadata 里这一个键，其余一律不碰
 *   · 会打印每个库「旧值 → 新值」，想还原就用 --value <旧值> 再跑一次
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const { runSql } = require('../src/sqlite');

const KEY = 'titleGenerationStrategy';
const VALID = ['utility', 'activeAgent', 'agentReview', 'deferred'];

const has = (f) => process.argv.includes(f);
function opt(f, dflt) {
    const i = process.argv.indexOf(f);
    return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
        ? process.argv[i + 1]
        : dflt;
}

function isCodeRunning() {
    try {
        const r = execSync('tasklist /nh /fo csv /fi "IMAGENAME eq Code.exe"', {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        });
        return r.trim().toLowerCase().startsWith('"code.exe"');
    } catch {
        return false;
    }
}

function agentSessionRoot() {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Code', 'agentSessionData');
}

/** 列出所有存在的 session.db */
function listDbs(root) {
    return fs.readdirSync(root)
        .map((n) => path.join(root, n, 'session.db'))
        .filter((p) => fs.existsSync(p));
}

async function readStrategy(db) {
    const r = await runSql(db, `SELECT value FROM session_metadata WHERE key='${KEY}';`);
    if (!r.ok) return { ok: false, error: r.error || r.stderr };
    const v = (r.stdout || '').trim();
    return { ok: true, value: v || null };
}

async function writeStrategy(db, value, del) {
    const sql = del
        ? `DELETE FROM session_metadata WHERE key='${KEY}';`
        : `INSERT OR REPLACE INTO session_metadata (key, value) VALUES ('${KEY}', '${value.replace(/'/g, "''")}');`;
    const r = await runSql(db, sql);
    return r.ok ? { ok: true } : { ok: false, error: r.error || r.stderr };
}

(async () => {
    const apply = has('--apply');
    const del = has('--delete');
    const force = has('--force');
    const value = opt('--value', 'utility');

    if (!del && !VALID.includes(value)) {
        console.log(`✗ --value 只能是: ${VALID.join(' / ')}`);
        process.exit(1);
    }

    const root = agentSessionRoot();
    if (!fs.existsSync(root)) {
        console.log(`✗ 没找到 agent 会话目录：${root}`);
        process.exit(1);
    }

    const dbs = listDbs(root);
    console.log(`agent 会话库: ${dbs.length} 个  (${root})`);
    console.log('');

    // ① 体检：统计现状
    const dist = new Map();
    let noKey = 0;
    const rows = [];
    for (const db of dbs) {
        const r = await readStrategy(db);
        if (!r.ok) {
            rows.push({ db, old: `?(读取失败: ${r.error})` });
            continue;
        }
        if (r.value === null) { noKey++; continue; }
        dist.set(r.value, (dist.get(r.value) || 0) + 1);
        rows.push({ db, old: r.value });
    }

    console.log('现状（已快照过策略的会话）:');
    for (const [k, n] of [...dist.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`  ${k.padEnd(12)} ×${n}`);
    }
    if (!dist.size) console.log('  （一个都没有）');
    console.log(`  未快照（键不存在）: ${noKey} 个 —— 这些本来就会用默认 utility`);
    console.log('');

    const target = del ? '(删除该键 → 回退默认 utility)' : value;
    if (!apply) {
        console.log(`[干跑] 将要写入: ${target}`);
        console.log('       加 --apply 才会真的写。');
        for (const x of rows.slice(0, 10)) {
            console.log(`   ${path.basename(path.dirname(x.db))}  ${x.old} → ${target}`);
        }
        if (rows.length > 10) console.log(`   ... 其余 ${rows.length - 10} 个同理`);
        return;
    }

    if (isCodeRunning() && !force) {
        console.log('⚠️  检测到 Code.exe 正在运行 —— 已中止。');
        console.log('    agent host 进程里缓着策略，不彻底退出很可能改了也白改。');
        console.log('    请完全退出 VS Code 后重跑；确认无所谓可加 --force。');
        process.exit(2);
    }

    // ② 写入
    let ok = 0;
    let fail = 0;
    for (const x of rows) {
        const w = await writeStrategy(x.db, value, del);
        if (w.ok) ok++;
        else {
            fail++;
            console.log(`   ✗ ${path.basename(path.dirname(x.db))}: ${w.error}`);
        }
    }
    console.log(`已写入: ${ok} 个成功${fail ? `，${fail} 个失败` : ''} → ${target}`);
    console.log('启动 VS Code 后，这些会话的标题生成就按新策略走了。');
})().catch((e) => {
    console.log('✗ 出错:', e && e.message ? e.message : e);
    process.exit(1);
});
