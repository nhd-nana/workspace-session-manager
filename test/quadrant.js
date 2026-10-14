// 四象限诊断：文件/索引 × 有内容/空，并估算面板实际会显示多少条
require('./stub').install();
const fs = require('fs');
const path = require('path');
const sqlite = require('../src/sqlite');
const store = require('../src/store');
const repair = require('../src/repair');

const u = path.join(process.env.APPDATA, 'Code', 'User');
const hash = process.argv[2] || (process.env.WSM_HASH || '');
const dir = path.join(u, 'workspaceStorage', hash);
const csDir = path.join(dir, 'chatSessions');

(async () => {
  const r = await sqlite.readIndex(path.join(dir, 'state.vscdb'));
  if (!r.ok) return console.log('读索引失败', r.error);
  const entries = r.index.entries;
  const local = Object.keys(entries).filter((k) => !/[:/]/.test(k));
  const ext = Object.keys(entries).filter((k) => /[:/]/.test(k));

  const files = fs.readdirSync(csDir).filter((n) => n.endsWith('.jsonl')).map((n) => n.slice(0, -6));
  const fileSet = new Set(files);
  const idxSet = new Set(local);

  const quad = {
    normalContent: [], normalEmpty: [],   // 索引有 + 文件有
    orphanContent: [], orphanEmpty: [],   // 索引无 + 文件有
    ghostContent: [], ghostEmpty: [],     // 索引有 + 文件无
  };

  for (const f of files) {
    const isEmpty = repair.isEmptySession(path.join(csDir, f + '.jsonl'));
    const inIdx = idxSet.has(f);
    const key = (inIdx ? 'normal' : 'orphan') + (isEmpty ? 'Empty' : 'Content');
    quad[key].push(f);
  }
  for (const k of local) {
    if (fileSet.has(k)) continue;
    quad[(entries[k].isEmpty ? 'ghostEmpty' : 'ghostContent')].push(k);
  }

  const extContent = ext.filter((k) => !entries[k].isEmpty).length;
  const extEmpty = ext.length - extContent;

  console.log(`工作区 ${hash}`);
  console.log(`磁盘会话文件 : ${files.length}`);
  console.log(`索引本地条目 : ${local.length}`);
  console.log(`索引外部条目 : ${ext.length}  (有内容 ${extContent} / 空 ${extEmpty})`);
  console.log('');

  console.log('              索引有    索引无     小计');
  console.log(`文件有·有内容   ${String(quad.normalContent.length).padStart(4)}   ${String(quad.orphanContent.length).padStart(6)}   ${String(quad.normalContent.length + quad.orphanContent.length).padStart(4)}`);
  console.log(`文件有·空       ${String(quad.normalEmpty.length).padStart(4)}   ${String(quad.orphanEmpty.length).padStart(6)}   ${String(quad.normalEmpty.length + quad.orphanEmpty.length).padStart(4)}`);
  console.log(`文件无(幽灵)    ${String(quad.ghostContent.length + quad.ghostEmpty.length).padStart(4)}        -      -`);
  console.log(`  其中 有内容/空  ${quad.ghostContent.length} / ${quad.ghostEmpty.length}`);
  console.log('');

  const est = quad.normalContent.length + extContent;
  console.log(`★ 面板应显示 ≈ ${est} 条  （本地有内容可见 ${quad.normalContent.length} + 外部有内容 ${extContent}）`);
  console.log(`★ 修复会话索引会：补入孤儿 ${quad.orphanContent.length} 条有内容 + 跳过 ${quad.orphanEmpty.length} 条空壳；清除幽灵 ${quad.ghostContent.length + quad.ghostEmpty.length} 条`);
  console.log(`★ 清理空会话会删：可见空会话 ${quad.normalEmpty.length} 条 + 孤儿空壳 ${quad.orphanEmpty.length} 条 = ${quad.normalEmpty.length + quad.orphanEmpty.length} 条（幽灵无文件，删不到）`);
  console.log('');

  // 标题对比：索引里的 title vs 文件里能提取到的 title
  console.log('--- 标题差异（索引 vs 文件，前 12 组）---');
  let n = 0;
  for (const k of quad.normalContent.concat(quad.orphanContent)) {
    const meta = store.readSessionMeta(path.join(csDir, k + '.jsonl'));
    const idxTitle = entries[k] ? entries[k].title : '(无索引条目)';
    const a = String(idxTitle || '');
    const b = String(meta.title || '');
    if (a.slice(0, 16) === b.slice(0, 16)) continue;
    console.log(`  索引: ${a.slice(0, 62)}`);
    console.log(`  文件: ${b.slice(0, 62)}`);
    console.log('');
    if (++n >= 12) break;
  }
  if (!n) console.log('  （无差异）');
})();
