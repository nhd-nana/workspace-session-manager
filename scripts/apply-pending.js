#!/usr/bin/env node
'use strict';
/**
 * apply-pending.js —— 把扩展记下的「待办改名」真正落盘。
 *
 * 背景：在**持有该会话的那个窗口**里改名不可靠（窗口保存时会按内存里的标题把整个
 * 会话文件重写成紧凑格式，把追加的 delta 抹掉）。所以扩展只把意图记进队列：
 *   %APPDATA%\Code\User\globalStorage\gy903.workspace-session-manager\pending-renames.json
 *
 * 什么时候跑：
 *   · 完全退出 VS Code 之后跑 —— 最彻底，没有内存副本抢写
 *   · 下次启动 VS Code 时扩展也会自动跑一遍队列（作为兜底）
 *
 * 用法（默认只体检）：
 *   node scripts/apply-pending.js
 *   node scripts/apply-pending.js --apply
 *
 * 幂等：先看会话文件尾部有没有同一条 delta，有就跳过；重复执行最多多一行无用 delta。
 */
const fs = require('fs');
const { execSync } = require('child_process');
const pending = require('../src/pending');

const has = (f) => process.argv.includes(f);

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

(async () => {
    const apply = has('--apply');
    const list = pending.load();
    console.log(`队列文件: ${pending.queuePath()}`);
    console.log(`待办条数: ${list.length}`);
    if (!list.length) {
        console.log('没有待办，收工。');
        return;
    }

    for (const e of list) {
        const exists = e.file && fs.existsSync(e.file);
        let cur = null;
        if (exists) { try { cur = pending.tailDelta(e.file); } catch { /* ignore */ } }
        // 列表显示看的是**索引**，文件对了不代表改成功
        let idx = null;
        if (e.dir && e.id) {
            try {
                const r = await require('../src/title').readIndexTitle(e.dir, e.id);
                idx = r.ok ? r.title : `(读不到: ${r.error})`;
            } catch (err) { idx = `(读不到: ${(err && err.message) || err})`; }
        }
        const fileOk = cur === e.title;
        const idxOk = idx === e.title;
        console.log(`\n  ${e.title}`);
        console.log(`    file    : ${e.file}${exists ? '' : '  ✗ 不存在'}`);
        console.log(`    文件尾部: ${cur === null ? '(无 customTitle delta)' : JSON.stringify(cur)}  ${fileOk ? '✅' : '✗'}`);
        console.log(`    索引标题: ${idx === null ? '(未记录 dir/id)' : JSON.stringify(idx)}  ${idxOk ? '✅' : '✗'}`);
        if (fileOk && idxOk) console.log('    状态    : 两处都已生效 → 会出队');
        else if (fileOk) console.log('    状态    : 只差索引（必须关掉 VS Code 才能修）');
        else console.log('    状态    : 需要写入会话文件');
    }

    if (!apply) {
        if (isCodeRunning()) {
            console.log('\n⚠️  VS Code 正在运行 —— 现在写入很可能被窗口回写覆盖。');
            console.log('    建议完全退出 VS Code 后加 --apply 重跑。');
        }
        console.log('\n[干跑] 加 --apply 才真的写。');
        return;
    }

    const r = await pending.applyAll({});
    console.log(`\n写入 ${r.applied.length} 个｜确认生效 ${r.confirmed.length} 个｜作废 ${r.dropped.length} 个｜失败 ${r.failed.length} 个`);
    for (const x of r.dropped) console.log(`  ✗ 作废: ${x.e && x.e.file} — ${x.reason || ''}`);
    for (const x of r.failed) console.log(`  ✗ 失败: ${x.e && x.e.file} — ${x.reason}`);
    console.log(r.remaining
        ? `队列里还剩 ${r.remaining} 条（下次启动会再核对一遍；两次都对上才出队）`
        : '队列已清空。');
})().catch((e) => {
    console.log('✗ 出错:', (e && e.message) || e);
    process.exit(1);
});
