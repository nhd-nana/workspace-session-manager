'use strict';
/**
 * live.js —— 判断「某个工作区当前有没有被 VS Code 窗口打开」。
 *
 * 🔴 为什么必须判断：`state.vscdb` 是活的 SQLite 连接。外部进程对它 `BEGIN IMMEDIATE` 期间，
 *    VS Code 自己写同一份库会撞锁 → 主进程抛未捕获的 `SQLITE_BUSY` → **直接闪退**
 *    （2026-10-26 实测崩溃转储 + main.log 证据）。
 *
 * 探测手段：读主窗口进程的命令行。实测形如
 *   Code.exe --folder-uri "file:///d%3A/Code"     单文件夹工作区
 *   Code.exe --file-uri   "file:///…/x.code-workspace"   多根工作区
 * （`state.vscdb-wal` 是否存在试过，全盘零个，不可用）
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const TTL = 5000;
let cache = { at: 0, set: new Set() };

const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

function decodeUri(raw) {
    try {
        const u = new URL(raw);
        let p = decodeURIComponent(u.pathname);
        if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1);   // /d:/Code → d:/Code
        if (u.host) p = '//' + u.host + p;            // vscode-remote://…
        return norm(p);
    } catch { return null; }
}

/** 当前所有 VS Code 窗口打开的目标（文件夹或 .code-workspace），归一化后的小写正斜杠路径 */
function openTargets() {
    if (Date.now() - cache.at < TTL) return cache.set;
    const out = new Set();
    try {
        const r = execSync(
            'powershell.exe -NoProfile -NonInteractive -Command ' +
            '"Get-CimInstance Win32_Process -Filter \\"Name=\'Code.exe\'\\" | ForEach-Object { $_.CommandLine }"',
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 8000 }
        );
        const re = /--(?:folder|file)-uri\s+"?([^\s"]+)"?/g;
        let m;
        while ((m = re.exec(r)) !== null) {
            const p = decodeUri(m[1]);
            if (p) out.add(p);
        }
    } catch { /* 探测失败就当没有窗口（调用方另有 currentDbPath 兜底） */ }
    cache = { at: Date.now(), set: out };
    return out;
}

/** 工作区存储目录 → 它对应的文件夹 / 工作区文件路径（归一化） */
function targetOfDir(dir) {
    try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, 'workspace.json'), 'utf8'));
        const raw = j.folder || j.workspace;
        return raw ? decodeUri(raw) : null;
    } catch { return null; }
}

/**
 * 这个 state.vscdb 所属的工作区，当前是否被某个窗口打开？
 * @param {string} dbPath state.vscdb 的完整路径
 */
function isDbOpen(dbPath) {
    const dir = path.dirname(dbPath);
    const t = targetOfDir(dir);
    if (!t) return false;
    return openTargets().has(t);
}

/** 仅供测试/排查：清空缓存 */
function resetCache() { cache = { at: 0, set: new Set() }; }

module.exports = { openTargets, targetOfDir, isDbOpen, resetCache };
