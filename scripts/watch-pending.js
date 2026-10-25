#!/usr/bin/env node
'use strict';
/**
 * watch-pending.js —— 分离进程，盯着「待办改名」队列，等目标工作区的窗口全部关闭后再落盘。
 *
 * 为什么需要「等」：
 *   会话数据两份（磁盘 + 窗口内存）。目标工作区若还开着，那个窗口保存时会按内存里的标题
 *   把整个 .jsonl 重写成紧凑格式，把追加的 delta 抹掉。等窗口关掉，文件就成终态了。
 *
 * 谁拉起它：扩展在「记入队列」成功后用 detached + unref 拉起（父进程死了它不死）。
 *
 * 用法：
 *   node scripts/watch-pending.js               # 守队列：为空就退出；目标窗口全关就落盘
 *   node scripts/watch-pending.js --probe 5     # 只发心跳 5 分钟，用来验证"关掉 VS Code 后它还活着"
 *   node scripts/watch-pending.js --no-popup    # 落盘后不弹窗
 *   node scripts/watch-pending.js --interval 3  # 轮询间隔（秒）
 *
 * 日志：<队列目录>\watch.log
 */
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const pending = require('../src/pending');

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const opt = (f, dflt) => {
    const i = argv.indexOf(f);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : dflt;
};

const INTERVAL_MS = Math.max(1, Number(opt('--interval', 3))) * 1000;
const PROBE_MIN = Number(opt('--probe', 0)) || 0;
const POPUP = !has('--no-popup');

function logLine(msg) {
    const line = `[${new Date().toISOString().slice(0, 19).replace('T', ' ')}] ${msg}`;
    try {
        fs.mkdirSync(path.dirname(pending.queuePath()), { recursive: true });
        fs.appendFileSync(path.join(path.dirname(pending.queuePath()), 'watch.log'), line + '\n', 'utf8');
    } catch { /* ignore */ }
    console.log(line);
}

/** 是否有任何 Code.exe 在跑 */
function anyCodeRunning() {
    try {
        const r = execSync('tasklist /nh /fo csv /fi "IMAGENAME eq Code.exe"', {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        });
        return r.trim().toLowerCase().startsWith('"code.exe"');
    } catch { return false; }
}

/** 当前所有 VS Code 窗口打开的文件夹 / 工作区文件（归一化为小写正斜杠） */
function openWindowTargets() {
    try {
        const r = execSync(
            'powershell.exe -NoProfile -NonInteractive -Command ' +
            '"Get-CimInstance Win32_Process -Filter \\"Name=\'Code.exe\'\\" | ForEach-Object { $_.CommandLine }"',
            { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
        );
        const out = new Set();
        const re = /--(?:folder|file)-uri\s+"?([^\s"]+)"?/g;
        let m;
        while ((m = re.exec(r)) !== null) {
            let p = null;
            try {
                const u = new URL(m[1]);
                p = decodeURIComponent(u.pathname);            // /d%3A/Code → /d:/Code
                if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1);    // 去掉前导 / → d:/Code
                if (u.host) p = '//' + u.host + p;
            } catch { /* 非标准 URI，忽略 */ }
            if (p) out.add(norm(p));
        }
        return out;
    } catch { return new Set(); }
}

const norm = (p) => String(p).replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** 工作区存储目录 → 它对应的文件夹 / 工作区文件路径 */
function workspaceTargetOf(dir) {
    try {
        const j = JSON.parse(fs.readFileSync(path.join(dir, 'workspace.json'), 'utf8'));
        const raw = j.folder || j.workspace;
        if (!raw) return null;
        const u = new URL(raw);
        let p = decodeURIComponent(u.pathname);
        if (/^\/[a-zA-Z]:/.test(p)) p = p.slice(1);
        if (u.host) p = '//' + u.host + p;
        return norm(p);
    } catch { return null; }
}

function popup(title, body) {
    if (!POPUP) return;
    try {
        const ps =
            'Add-Type -AssemblyName System.Windows.Forms;' +
            '[System.Windows.Forms.MessageBox]::Show(' +
            JSON.stringify(body) + ',' + JSON.stringify(title) +
            ',[System.Windows.Forms.MessageBoxButtons]::OK,' +
            '[System.Windows.Forms.MessageBoxIcon]::Information) | Out-Null';
        spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
            detached: true,
            stdio: 'ignore',
            windowsHide: false
        }).unref();
    } catch { /* ignore */ }
}

/* ---------- pid 锁：避免重复拉起 ---------- */
const lockFile = path.join(path.dirname(pending.queuePath()), 'watch.pid');
function pidAlive(pid) {
    try {
        const r = execSync(`tasklist /nh /fo csv /fi "PID eq ${pid}"`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        });
        return r.includes(String(pid));
    } catch { return false; }
}
try {
    if (fs.existsSync(lockFile)) {
        const other = Number(fs.readFileSync(lockFile, 'utf8').trim());
        if (other && other !== process.pid && pidAlive(other)) {
            logLine(`已有 watcher 在跑 (pid ${other})，本实例退出`);
            process.exit(0);
        }
    }
    fs.writeFileSync(lockFile, String(process.pid), 'utf8');
} catch { /* ignore */ }
function releaseLock() {
    try {
        if (Number(fs.readFileSync(lockFile, 'utf8').trim()) === process.pid) fs.unlinkSync(lockFile);
    } catch { /* ignore */ }
}
process.on('exit', releaseLock);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    if (PROBE_MIN > 0) {
        const until = Date.now() + PROBE_MIN * 60000;
        logLine(`probe 模式启动 pid=${process.pid}，持续 ${PROBE_MIN} 分钟；关掉 VS Code 后应继续心跳`);
        while (Date.now() < until) {
            logLine(`心跳 pid=${process.pid} Code.exe 在跑=${anyCodeRunning()}`);
            await sleep(5000);
        }
        logLine('probe 结束');
        return;
    }

    logLine(`watcher 启动 pid=${process.pid}，间隔 ${INTERVAL_MS / 1000}s，队列=${pending.load().length} 条`);
    for (;;) {
        const list = pending.load();
        if (!list.length) { logLine('队列已空，退出'); return; }

        if (!anyCodeRunning()) {
            logLine('Code.exe 已全部退出 → 落盘');
            const r = await pending.applyAll({});
            logLine(`写入 ${r.applied.length}｜已生效 ${r.already.length}｜作废 ${r.dropped.length}｜失败 ${r.failed.length}`);
            if (r.applied.length) {
                popup('工作区管家', `已补写 ${r.applied.length} 条会话改名。`);
            }
            return;
        }

        const open = openWindowTargets();
        const dirs = [...new Set(list.map((e) => e.dir).filter(Boolean))];
        const stillOpen = dirs.filter((d) => {
            const t = workspaceTargetOf(d);
            return t !== null && open.has(t);
        });

        if (!stillOpen.length) {
            logLine('目标工作区已无窗口打开 → 落盘');
            const r = await pending.applyAll({});
            logLine(`写入 ${r.applied.length}｜已生效 ${r.already.length}｜作废 ${r.dropped.length}｜失败 ${r.failed.length}`);
            if (r.applied.length) {
                popup('工作区管家', `已补写 ${r.applied.length} 条会话改名。`);
            }
            return;
        }
        logLine(`等待中：${stillOpen.length} 个目标工作区仍开着（队列 ${list.length} 条）`);
        await sleep(INTERVAL_MS);
    }
})().catch((e) => {
    logLine(`✗ 出错: ${(e && e.message) || e}`);
    process.exit(1);
});
