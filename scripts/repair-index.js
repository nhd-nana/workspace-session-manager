#!/usr/bin/env node
'use strict';
/**
 * repair-index.js —— 脱离 VS Code 运行的「会话索引修复」工具
 *
 * 为什么需要它：扩展内**无法安全写当前工作区**的索引 ——
 * VS Code 内存里持有 ChatSessionStore 的 indexCache，下次会话变更（storeSessions）
 * 会把盘上的索引整体覆盖，写入瞬间失效。所以「修当前工作区」必须等 VS Code 退出后执行。
 *
 * 用法（不加 --apply 一律只体检、不写盘）：
 *   node scripts/repair-index.js --list
 *   node scripts/repair-index.js --hash <hash>   [--apply] [--min-bytes 2048]
 *   node scripts/repair-index.js --path "d:\your-project" [--apply]
 *
 * 安全特性：
 *   · 检测到 Code.exe 在跑 → 默认拒绝（--force 可跳过，但后果自负）
 *   · 写盘前先备份 state.vscdb → <db>.wsmgr-bak-<时间戳>
 *   · 外部会话（agent-host-copilotcli:/… 等，实体在 agentSessionData）永不清理
 *   · 只增删索引条目，**从不删除任何会话文件**
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const store = require('../src/store');
const repair = require('../src/repair');

const WS_ROOT = path.join(process.env.APPDATA || '', 'Code', 'User', 'workspaceStorage');

function parseArgs(argv) {
    const o = { apply: false, list: false, force: false, minBytes: undefined, hash: null, target: null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--apply') o.apply = true;
        else if (a === '--list') o.list = true;
        else if (a === '--force') o.force = true;
        else if (a === '--hash') o.hash = argv[++i];
        else if (a === '--path') o.target = argv[++i];
        else if (a === '--min-bytes') o.minBytes = Number(argv[++i]);
    }
    return o;
}

/** 不依赖 vscode.Uri 的 workspace.json 解码 */
function folderOf(dir) {
    const f = path.join(dir, 'workspace.json');
    if (!fs.existsSync(f)) return '(无 workspace.json)';
    try {
        const j = JSON.parse(fs.readFileSync(f, 'utf8'));
        const raw = j.folder || j.workspace || '';
        if (!raw) return '(空)';
        let p = raw.replace(/^[a-z-]+:\/\/\//i, '');
        try { p = decodeURIComponent(p); } catch { /* ignore */ }
        return p.replace(/\//g, '\\');
    } catch { return '(解析失败)'; }
}

function listWorkspaces() {
    if (!fs.existsSync(WS_ROOT)) return [];
    return fs.readdirSync(WS_ROOT, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => {
            const dir = path.join(WS_ROOT, e.name);
            const csDir = path.join(dir, 'chatSessions');
            let n = 0;
            try { n = fs.readdirSync(csDir).filter((x) => x.endsWith('.jsonl')).length; } catch { /* ignore */ }
            return { hash: e.name, dir, folder: folderOf(dir), sessions: n };
        })
        .sort((a, b) => b.sessions - a.sessions);
}

function vscodeRunning() {
    try {
        const r = execSync('tasklist /nh /fo csv /fi "IMAGENAME eq Code.exe"', {
            encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']
        });
        return r.trim().toLowerCase().startsWith('"code.exe"');
    } catch { return false; }
}

function makeEntry(hash) {
    const dir = path.join(WS_ROOT, hash);
    const csDir = path.join(dir, 'chatSessions');
    let sessionFiles = [];
    try {
        sessionFiles = fs.readdirSync(csDir)
            .filter((n) => n.endsWith('.jsonl'))
            .map((n) => path.join(csDir, n));
    } catch { /* ignore */ }
    // isCurrent 留空：本脚本的存在前提就是 VS Code 已退出，无需再拦
    return { hash, dir, isCurrent: false, sessionFiles };
}

const kb = (n) => `${Math.round(n / 1024)} KB`;
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
const fmt = (ms) => (ms ? new Date(ms).toISOString().slice(0, 16).replace('T', ' ') : '?');

async function main() {
    const o = parseArgs(process.argv.slice(2));

    if (o.list || (!o.hash && !o.target)) {
        console.log('workspaceStorage:', WS_ROOT, '\n');
        for (const w of listWorkspaces()) {
            console.log(`  ${String(w.sessions).padStart(4)} sessions  ${w.hash}  ${w.folder}`);
        }
        if (!o.list) console.log('\n用法: node scripts/repair-index.js --hash <hash> [--apply]');
        return;
    }

    let hash = o.hash;
    if (!hash && o.target) {
        const want = path.resolve(o.target).toLowerCase();
        const hit = listWorkspaces().find((w) => w.folder && path.resolve(w.folder).toLowerCase() === want);
        if (!hit) { console.error(`找不到与 ${o.target} 匹配的工作区存储。用 --list 看看有哪些。`); process.exit(1); }
        hash = hit.hash;
    }
    const dir = path.join(WS_ROOT, hash);
    if (!fs.existsSync(dir)) { console.error(`工作区存储不存在：${dir}`); process.exit(1); }

    // 只在真要写盘时才拦：体检（dry-run）随时可以做
    if (o.apply && vscodeRunning() && !o.force) {
        console.error(
            '\n⚠️  检测到 Code.exe 正在运行 —— 已中止写入。\n' +
            '    VS Code 内存中的索引会在下次会话变更时把本次修复整体覆盖。\n' +
            '    请完全退出 VS Code 后重试；若你确信该工作区的窗口已关闭，可加 --force 跳过此检查。\n'
        );
        process.exit(2);
    }

    const entry = makeEntry(hash);
    console.log(`工作区: ${folderOf(dir)}`);
    console.log(`存储  : ${dir}`);
    console.log(`会话文件: ${entry.sessionFiles.length}\n`);

    const p = await repair.plan(entry, { minBytes: o.minBytes });
    if (!p.ok) { console.error('读取索引失败：' + p.error); process.exit(1); }

    const localCount = Object.keys(p.entries).length - p.external.length;
    console.log(`索引条目 ${Object.keys(p.entries).length}（本地 ${localCount} / 外部 ${p.external.length}）`);
    console.log(`  可见 ${p.visible.length}　孤儿 ${p.orphan.length}　幽灵条目 ${p.ghost.length}\n`);

    console.log(`将补进索引 ${p.toAdd.length} 条（${mb(p.bytesAdded)}）:`);
    for (const f of p.toAdd.slice(0, 15)) {
        const meta = store.readSessionMeta(f.file);
        console.log(`   ${fmt(f.mtime)}  ${kb(f.size).padStart(9)}  ${meta.title || '(无标题)'}`);
    }
    if (p.toAdd.length > 15) console.log(`   ... 其余 ${p.toAdd.length - 15} 条`);

    console.log(`\n跳过空壳 ${p.skipped.length} 条（< ${p.minBytes} 字节，补回去只会是空白项）`);
    console.log(`清除幽灵条目 ${p.toRemove.length} 条`);
    for (const id of p.toRemove) {
        const e = p.entries[id];
        console.log(`   ${fmt(e && e.lastMessageDate)}  ${id}`);
    }

    if (!o.apply) {
        console.log('\n（当前是体检模式，未写入任何内容。要真正执行请加 --apply）');
        return;
    }
    if (!p.toAdd.length && !p.toRemove.length) { console.log('\n无需改动。'); return; }

    const r = await repair.apply(entry, p);
    if (!r.ok) { console.error('\n修复失败：' + r.error); process.exit(1); }
    console.log(`\n✅ 完成：补入 ${r.added} 条，清除 ${r.removed} 条，索引现有 ${r.total} 条`);
    console.log(`   备份：${r.backup}`);
    console.log('   重新打开 VS Code 即可在聊天面板看到它们。');
}

main().catch((e) => { console.error(e); process.exit(1); });
