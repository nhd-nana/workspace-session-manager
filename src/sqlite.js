'use strict';
/**
 * sqlite.js —— 访问 state.vscdb（SQLite）里的 Copilot 会话索引。
 *
 * 为什么用 sqlite3 CLI 而不是 npm 包：
 *   - `node:sqlite` 在 Electron 里需要 --experimental-sqlite，不可靠
 *   - `better-sqlite3` 等原生模块要按 Electron ABI 重编译，太重
 *   - 本机已有 `sqlite3`（D:\DevTools\bin\sqlite3.cmd，3.44.4）→ **零新依赖**
 *
 * 安全约定：
 *   ✅ 读：任何 DB 都可以（含当前工作区；delete journal 模式下读不写锁）
 *   🚫 写：**只允许写「非当前工作区」的库**（当前工作区的写入会被 VS Code 内存索引覆盖）
 *   SQL 一律走 **stdin**（避免 Windows 引号地狱）；大值写入用 readfile() + CAST(... AS TEXT)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { t } = require('./l10n');
const live = require('./live');

const IDX_KEY = 'chat.ChatSessionStore.index';

function runSql(dbPath, sql, timeoutMs = 20000) {
    return new Promise((resolve) => {
        let out = '';
        let err = '';
        let p;
        try {
            // Windows 上 sqlite3 是 .cmd，直接用 shell:true 引号会炸 → 走 cmd /c + 参数数组
            p = spawn('cmd.exe', ['/c', 'sqlite3', dbPath], {
                windowsHide: true,
                stdio: ['pipe', 'pipe', 'pipe']
            });
        } catch (e) {
            return resolve({ ok: false, error: String(e && e.message || e) });
        }
        const timer = setTimeout(() => {
            try { p.kill(); } catch { /* ignore */ }
            resolve({ ok: false, error: t('sqlite3 timed out after {0} ms', timeoutMs) });
        }, timeoutMs);

        p.stdout.on('data', (d) => { out += d.toString('utf8'); });
        p.stderr.on('data', (d) => { err += d.toString('utf8'); });
        p.on('error', (e) => {
            clearTimeout(timer);
            resolve({ ok: false, error: t('Cannot start sqlite3: {0} (make sure it is on PATH)', e.message) });
        });
        p.on('close', (code) => {
            clearTimeout(timer);
            resolve({ ok: code === 0, code, stdout: out, stderr: err });
        });

        try { p.stdin.write(sql + '\n'); p.stdin.end(); } catch { /* ignore */ }
    });
}

/** sqlite3 是否可用（结果缓存） */
let _avail = null;
async function isAvailable() {
    if (_avail !== null) return _avail;
    const r = await runSql(':memory:', 'SELECT 1;', 8000);
    _avail = !!(r.ok && /1/.test(r.stdout));
    if (!_avail) _avail = null;   // 失败不缓存死，下次可重试
    return !!_avail;
}

/** 读会话索引；返回 { ok, index?, error? } */
async function readIndex(dbPath) {
    if (!fs.existsSync(dbPath)) return { ok: false, error: t('state.vscdb not found') };
    const r = await runSql(dbPath, `SELECT value FROM ItemTable WHERE key='${IDX_KEY}';`);
    if (!r.ok) return { ok: false, error: r.error || r.stderr || t('sqlite3 exited with code {0}', r.code) };
    const txt = (r.stdout || '').trim();
    if (!txt) return { ok: true, index: { version: 1, entries: {} } };
    try {
        const j = JSON.parse(txt);
        if (!j || typeof j !== 'object' || !j.entries) return { ok: false, error: t('Unexpected index structure') };
        return { ok: true, index: j };
    } catch (e) {
        return { ok: false, error: t('Failed to parse index JSON: {0}', e.message) };
    }
}

/**
 * 写回会话索引。
 *
 * 🔴 **绝不在「拥有这个库的窗口还开着」时写。**
 *   `state.vscdb` 是活的 SQLite 连接；外部 `BEGIN IMMEDIATE` 期间 VS Code 自己写同一份库会撞锁，
 *   主进程抛未捕获的 `SQLITE_BUSY` → **整个窗口闪退**（2026-10-26 实测崩dump + main.log）。
 *   除了「锁」的问题，窗口内存里还有整份索引副本，外部写完也会被它冲掉。
 *   → 运行时一律拒绝；只有在 VS Code 完全退出后跑 `scripts/apply-pending.js` 才允许。
 */
async function writeIndex(dbPath, indexObj, currentDbPath) {
    if (currentDbPath && path.resolve(dbPath).toLowerCase() === path.resolve(currentDbPath).toLowerCase()) {
        return { ok: false, error: t('Refusing to write: the target is the current workspace database (VS Code would overwrite it from its in-memory index)') };
    }
    if (!process.env.WSMGR_FORCE && live.isDbOpen(dbPath)) {
        return {
            ok: false,
            error: t('Refusing to write: the workspace owning this database is open in a VS Code window. Writing it from outside makes VS Code hit SQLITE_BUSY and crash. Close that window first.')
        };
    }
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsmgr-'));
    const tmpFile = path.join(tmpDir, 'index.json');
    try {
        fs.writeFileSync(tmpFile, JSON.stringify(indexObj), 'utf8');
        const sqlPath = tmpFile.replace(/\\/g, '/').replace(/'/g, "''");
        const sql = [
            'BEGIN IMMEDIATE;',
            `UPDATE ItemTable SET value=CAST(readfile('${sqlPath}') AS TEXT) WHERE key='${IDX_KEY}';`,
            'COMMIT;'
        ].join('\n');
        const r = await runSql(dbPath, sql);
        if (!r.ok) return { ok: false, error: r.error || r.stderr || t('sqlite3 exited with code {0}', r.code) };
        return { ok: true };
    } finally {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
}

module.exports = { IDX_KEY, isAvailable, readIndex, writeIndex, runSql };
