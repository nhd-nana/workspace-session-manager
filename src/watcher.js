'use strict';
/**
 * watcher.js —— 用**分离进程**拉起 scripts/watch-pending.js。
 *
 * 要点：
 *   · detached: true + unref() → VS Code 关闭后子进程继续活
 *   · stdio: 'ignore'         → 不占管道，父进程死了不会因为写管道崩溃
 *   · windowsHide: true       → 不弹黑框（要弹窗由脚本自己用 MessageBox）
 *
 * 找不到 node 时的兜底：用 Electron 自带 node 模式（ELECTRON_RUN_AS_NODE=1）。
 */
const path = require('path');
const { spawn, execFileSync } = require('child_process');

function findNode() {
    try {
        const r = execFileSync('where', ['node'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
        const first = r.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0];
        if (first) return { cmd: first, env: {} };
    } catch { /* ignore */ }
    return { cmd: process.execPath, env: { ELECTRON_RUN_AS_NODE: '1' } };
}

/**
 * 拉起 watcher（若已在跑，脚本自己会用 pid 锁退出）。
 * @param {string} extensionPath 扩展根目录
 * @param {string[]} args 额外参数，如 ['--probe','5']
 */
function spawnWatcher(extensionPath, args = []) {
    const script = path.join(extensionPath, 'scripts', 'watch-pending.js');
    const { cmd, env } = findNode();
    const child = spawn(cmd, [script, ...args], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        cwd: extensionPath,
        env: { ...process.env, ...env }
    });
    child.unref();
    return { ok: true, pid: child.pid, cmd };
}

module.exports = { spawnWatcher, findNode };
