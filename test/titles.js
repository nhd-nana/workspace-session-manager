// 标题体检：现在哪些条目缺标题？缺的会话文件里，首条消息的真实结构是什么？
require('./stub').install();
const fs = require('fs');
const path = require('path');
const sqlite = require('../src/sqlite');
const store = require('../src/store');

const u = path.join(process.env.APPDATA, 'Code', 'User');
const hash = process.argv[2] || (process.env.WSM_HASH || '');
const dir = path.join(u, 'workspaceStorage', hash);
const csDir = path.join(dir, 'chatSessions');

(async () => {
  const r = await sqlite.readIndex(path.join(dir, 'state.vscdb'));
  if (!r.ok) return console.log('读索引失败', r.error);
  const e = r.index.entries;
  const keys = Object.keys(e);
  const local = keys.filter((k) => !/[:/]/.test(k));
  const ext = keys.filter((k) => /[:/]/.test(k));

  console.log(`索引 ${keys.length} 条（本地 ${local.length} / 外部 ${ext.length}）\n`);

  const DEFAULTS = new Set(['', '(无标题)', 'New Chat', '新建聊天', undefined, null]);
  const bad = local.filter((k) => DEFAULTS.has(e[k].title));
  const good = local.filter((k) => !DEFAULTS.has(e[k].title));

  // 标题取值分布（交叉 isEmpty）
  const dist = {};
  for (const k of local) {
    const t = e[k].title === undefined ? '(undefined)' : e[k].title;
    const label = t === '' ? '(空字符串)' : t;
    if (!dist[label]) dist[label] = { n: 0, empty: 0, size: 0 };
    dist[label].n++;
    if (e[k].isEmpty) dist[label].empty++;
  }
  const defCount = local.filter((k) => DEFAULTS.has(e[k].title) && e[k].title !== '(无标题)').length;
  const reallyMissing = local.filter((k) => e[k].title === '(无标题)' || e[k].title === '' || e[k].title === undefined);
  console.log('--- 标题取值分布（本地条目）---');
  console.log(`  「新建聊天/New Chat」等默认标题: ${defCount} 条`);
  console.log(`  真正为「(无标题)/空/undefined」 : ${reallyMissing.length} 条`);
  console.log(`  有实际标题                    : ${good.length} 条`);
  if (reallyMissing.length) {
    for (const k of reallyMissing.slice(0, 15)) {
      const f = path.join(csDir, k + '.jsonl');
      const size = fs.existsSync(f) ? fs.statSync(f).size : -1;
      console.log(`     ${k}  ${size}B  isEmpty=${e[k].isEmpty}`);
    }
  }

  console.log(`\n有标题 ${good.length} 条 / 缺标题 ${bad.length} 条\n`);

  console.log('--- 有标题的（前 15）---');
  for (const k of good.slice(0, 15)) {
    console.log(`  [${e[k].isEmpty ? '空' : '有内容'}] ${String(e[k].title).slice(0, 60)}`);
  }

  if (!bad.length) return;

  console.log(`\n--- 缺标题的 ${bad.length} 条（前 10）---`);
  for (const k of bad.slice(0, 10)) {
    const f = path.join(csDir, k + '.jsonl');
    const exists = fs.existsSync(f);
    const size = exists ? fs.statSync(f).size : 0;
    console.log(`  ${k}  title=${JSON.stringify(e[k].title)}  isEmpty=${e[k].isEmpty}  ${size}B  ${exists ? '' : '(文件不存在)'}`);
  }

  // 取第一条缺标题的（且文件存在）看结构
  const sample = bad.map((k) => ({ k, f: path.join(csDir, k + '.jsonl') })).find((x) => fs.existsSync(x.f) && fs.statSync(x.f).size > 3000);
  if (!sample) return console.log('\n（缺标题的都太小，无法取样）');

  console.log(`\n=== 样本 ${sample.k} (${fs.statSync(sample.f).size}B) ===`);
  const raw = fs.readFileSync(sample.f, 'utf8');
  const lines = raw.split('\n').filter((l) => l.trim());
  console.log('行数:', lines.length);
  for (let i = 0; i < Math.min(lines.length, 3); i++) {
    let j;
    try { j = JSON.parse(lines[i]); } catch { console.log(`  第${i + 1}行 解析失败，前 200 字符:`, lines[i].slice(0, 200)); continue; }
    if (j.kind === 0) {
      const reqs = j.v && j.v.requests;
      console.log(`  第${i + 1}行 kind0: customTitle=${JSON.stringify(j.v && j.v.customTitle)}  requests=${Array.isArray(reqs) ? reqs.length : typeof reqs}`);
      if (Array.isArray(reqs) && reqs[0]) {
        console.log('    requests[0] 的字段:', Object.keys(reqs[0]).join(', '));
        console.log('    message =', JSON.stringify(reqs[0].message).slice(0, 400));
      }
    } else {
      console.log(`  第${i + 1}行 kind${j.kind}: k=${JSON.stringify(j.k)} v 前 200 = ${JSON.stringify(j.v).slice(0, 200)}`);
    }
  }

  // 用现有提取器试试
  const meta = store.readSessionMeta(sample.f);
  console.log('\nreadSessionMeta →', JSON.stringify(meta.title), '| created =', meta.created);
})();
