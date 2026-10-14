'use strict';
/**
 * 冒烟测试：把 `vscode` 模块换成最小桩，直接在 Node 里跑 store 的核心逻辑。
 * 用法： node test/smoke.js
 */
const path = require('path');
const Module = require('module');
const { fileURLToPath } = require('url');

let requestCount = 0;
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === 'vscode') {
    return {
      Uri: {
        // 最小模拟 vscode.Uri.parse：支持 file 与 vscode-remote 等自定义协议
        parse: (s) => {
          const m = /^([A-Za-z][A-Za-z0-9+.\-]*):\/\/([^/?#]*)([^?#]*)/.exec(s);
          if (!m) throw new Error('bad uri: ' + s);
          const scheme = m[1].toLowerCase();
          const authority = decodeURIComponent(m[2] || '');
          const pathPart = decodeURIComponent(m[3] || '');
          const isFile = scheme === 'file';
          return {
            scheme,
            authority,
            path: pathPart,
            fsPath: isFile ? fileURLToPath(s) : null   // 真实 API 对非 file 不可用
          };
        },
        file: (p) => ({ scheme: 'file', authority: '', path: p, fsPath: p })
      }
    };
  }
  return origLoad.call(this, request, ...rest);
};

const store = require('../src/store');
const { fmtSize, fmtDate } = require('../src/util');

const userDir = path.join(process.env.APPDATA, 'Code', 'User');
// 当前窗口的 hash（用 $env:WSM_HASH 指定；留空则不作“当前工作区”标记）
const CURRENT_HASH = (process.env.WSM_HASH || '');

const context = {
  globalStorageUri: { fsPath: path.join(userDir, 'globalStorage', 'gy903.workspace-session-manager') },
  storageUri: { fsPath: path.join(userDir, 'workspaceStorage', CURRENT_HASH, 'gy903.workspace-session-manager') }
};

const t0 = Date.now();
const { root, items } = store.scan(context);
const t1 = Date.now();

console.log('storage root :', root);
console.log('条目数       :', items.length, `（扫描耗时 ${t1 - t0} ms）`);
console.log('');
console.log('位  ' + '名称'.padEnd(34) + '会话  存在   最后使用      建议');
console.log('-'.repeat(115));
for (const w of items) {
  const reason = store.suggestReason(w) || '';
  const mark = w.isCurrent ? '★当前' : (w.remote ? ' 🌐  ' : (w.folderExists ? '     ' : '  ✗  '));
  const ex = w.remote ? '远程' : (w.folderExists ? '是' : '否');
  console.log(
    mark + ' ' +
    String(w.label).slice(0, 32).padEnd(32) + '  ' +
    String(w.sessionFiles.length).padStart(3) + '   ' +
    ex.padEnd(4) + '  ' +
    fmtDate(w.mtime).padEnd(12) + '  ' + reason
  );
}

// 抽一个工作区验证「体积拆解 + 会话元信息」
const target = items.find((i) => i.sessionFiles.length > 0) || items[0];
if (target) {
  console.log('');
  store.computeSize(target);
  console.log(`== 体积拆解：${target.label}　合计 ${fmtSize(target.size)} ==`);
  for (const p of target.parts.slice(0, 8)) {
    if (p.bytes > 0) console.log('   ' + p.name.padEnd(32) + fmtSize(p.bytes));
  }
  const sess = store.loadSessions(target);
  console.log('');
  console.log(`== 会话元信息（前 5 / 共 ${sess.length}）==`);
  for (const s of sess.slice(0, 5)) {
    console.log(`   ${String(s.title || '(无标题)').slice(0, 46).padEnd(48)} ${fmtDate(s.created)}`);
  }
}

// ---- SQLite 索引：可见性统计（走 sqlite3 CLI）----
(async () => {
  const sqlite = require('../src/sqlite');
  const ok = await sqlite.isAvailable();
  console.log('');
  console.log('sqlite3 可用:', ok);
  if (!ok) return;

  const cand = items.filter((i) => i.sessionFiles.length > 5).slice(0, 3);
  for (const w of cand) {
    const t0 = Date.now();
    await store.ensureIndex(w);
    const v = store.visibility(w);
    const dt = Date.now() - t0;
    console.log('');
    console.log(`== 索引可见性：${w.label}  （读索引 ${dt} ms）==`);
    if (!v.known) { console.log('   读取失败：', v.error); continue; }
    console.log(`   索引条目 ${v.indexed}    JSONL ${v.jsonl}    可见 ${v.visible}    孤儿 ${v.orphan}    幽灵 ${v.ghost}`);
    const sess = store.loadSessions(w);
    const orph = sess.filter((s) => s.orphan).slice(0, 3);
    if (orph.length) {
      console.log('   孤儿示例:', orph.map((s) => `${s.id.slice(0, 8)}(${fmtDate(s.created)})`).join(', '));
    }
  }
})();
