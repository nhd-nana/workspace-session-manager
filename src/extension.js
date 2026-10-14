'use strict';
/**
 * extension.js —— 工作区管家入口。
 *
 * 设计基调（用户明确要求）：
 *   ✅ 只「一览 + 推荐」，删除必须由用户从右键菜单显式触发，且二次确认
 *   ✅ 一律走系统回收站（vscode.workspace.fs.delete + useTrash）
 *   ❌ 不做任何自动清理
 */
const vscode = require('vscode');
const os = require('os');
const path = require('path');
const { WorkspaceTreeProvider, Node } = require('./tree');
const store = require('./store');
const repair = require('./repair');
const transfer = require('./transfer');
const dup = require('./dup');
const { fmtSize, fmtDate } = require('./util');

/** 命令参数可能是 TreeView 的 element（我们的 Node），也可能是直接传的对象 */
function unwrap(x) {
  if (x instanceof Node) return x.data;
  return x;
}

function activate(context) {
  const provider = new WorkspaceTreeProvider(context);
  provider.refresh();

  const view = vscode.window.createTreeView('wsManager.workspaces', {
    treeDataProvider: provider,
    showCollapseAll: true,
    canSelectMany: true          // 支持 Ctrl / Shift 多选会话 → 批量复制 / 移动
  });
  context.subscriptions.push(view);

  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  context.subscriptions.push(bar);

  const reg = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  // ---------- 体积计算（后台、分批、可中断） ----------
  async function sizeAll() {
    const pending = provider.state.items.filter((i) => i.size === null).length;
    if (!pending) return;
    bar.show();
    try {
      await provider.computeAllSizes((done, total) => {
        bar.text = `$(sync~spin) 计算工作区体积 ${done}/${total}`;
      });
      bar.text = '$(check) 工作区体积已更新';
      setTimeout(() => bar.hide(), 4000);
    } catch {
      bar.text = '$(warning) 体积计算中断';
      setTimeout(() => bar.hide(), 4000);
    }
  }

  reg('wsManager.refresh', async () => {
    provider.refresh();
    const n = provider.state.items.length;
    const cur = provider.state.items.find((i) => i.isCurrent);
    vscode.window.setStatusBarMessage(
      `工作区管家：${n} 个工作区${cur ? `，当前 ${cur.label}` : ''}`, 3000
    );
    await sizeAll();
  });

  // ---------- 打开 / 定位 / 复制 ----------
  reg('wsManager.openWorkspace', (node) => {
    const w = unwrap(node);
    if (!w || !w.folderPath) return void vscode.window.showWarningMessage('这条条目没有可用的目录路径。');
    if (!w.folderExists) return void vscode.window.showWarningMessage(`目录不存在：${w.folderPath}`);
    vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(w.folderPath), { forceNewWindow: true });
  });

  reg('wsManager.revealFolder', (node) => {
    const w = unwrap(node);
    if (!w || !w.folderExists) return void vscode.window.showWarningMessage('目录不存在，无法定位。');
    vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(w.folderPath));
  });

  reg('wsManager.copyPath', async (node) => {
    const w = unwrap(node);
    const text = w && (w.folderPath || w.dir);
    if (!text) return;
    await vscode.env.clipboard.writeText(text);
    vscode.window.setStatusBarMessage(`已复制：${text}`, 3000);
  });

  // ---------- 查找重复会话（跨工作区） ----------
  reg('wsManager.findDuplicates', async () => {
    const busy = vscode.window.setStatusBarMessage('$(sync~spin) 正在比对会话指纹…');
    let r;
    try {
      r = dup.findDuplicates(provider.state.items);
    } finally {
      busy.dispose();
    }

    if (!r.groups.length) {
      return void vscode.window.showInformationMessage(
        `已比对 ${r.scanned} 个会话文件，没有发现重复。`
      );
    }

    const lines = [];
    lines.push('# 重复会话');
    lines.push('');
    lines.push(`> 比对 ${r.scanned} 个会话文件（指纹 = 文件大小 + 前 64 KB 的 SHA-1）`);
    lines.push(`> 发现 **${r.groups.length} 组**重复，冗余约 **${fmtSize(r.bytes)}**`);
    lines.push('');
    lines.push('**本报告不会删除任何东西。** 每组里保留一份即可回收标题上的冗余量。');
    lines.push('');
    for (const g of r.groups) {
      const wasted = g.size * (g.copies.length - 1);
      lines.push(`## ${fmtSize(g.size)} × ${g.copies.length}　—— 冗余 ${fmtSize(wasted)}${g.sameId ? '' : '　⚠️ 不同 ID 但内容相同'}`);
      lines.push('');
      for (const c of g.copies) {
        lines.push(`- ${c.isCurrent ? '🟢 ' : ''}**${c.label}**　\`${c.id}\`　${c.file}`);
      }
      lines.push('');
    }
    await showMarkdown('重复会话', lines);
  });

  /**
   * 展示一份 Markdown 报告。
   * ⚠️ 写成**带 .md 后缀的真实文件**（落在系统临时目录，文件名固定，每次覆盖不堆积），
   *    而不是 untitled 文档 —— untitled 没有后缀，无法享受「打开 .md 就渲染」的编辑器关联。
   * 如果你再配上：`"workbench.editorAssociations": { "*.md": "vscode.markdown.preview.editor" }`，
   * 报告会直接以渲染形式打开。
   */
  async function showMarkdown(name, lines) {
    const file = path.join(os.tmpdir(), `workspace-session-manager-${name}.md`);
    await vscode.workspace.fs.writeFile(vscode.Uri.file(file), Buffer.from(lines.join('\n'), 'utf8'));
    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(file));
    await vscode.window.showTextDocument(doc, { preview: false });
  }

  // ---------- 总览报告 ----------
  reg('wsManager.showReport', async () => {
    const items = provider.state.items;
    const lines = [];
    lines.push('# workspaceStorage 总览');
    lines.push('');
    lines.push(`> 生成 ${new Date().toLocaleString()}　｜　共 ${items.length} 个条目`);
    lines.push('');
    lines.push('| | 工作区 | 目录存在 | 体积 | 会话 | 最后使用 | 建议 |');
    lines.push('|---|---|---|---:|---:|---|---|');
    for (const w of items) {
      const reason = store.suggestReason(w) || '';
      const existsCell = w.remote ? '🌐远程' : (w.folderExists ? '✅' : '❌');
      lines.push(`| ${w.isCurrent ? '🟢当前' : ''} | \`${w.folderDisplay || w.label}\` | ${existsCell} | ${w.size === null ? '—' : fmtSize(w.size)} | ${w.sessionFiles.length} | ${fmtDate(w.mtime)} | ${reason} |`);
    }
    lines.push('');
    lines.push('## 体积构成');
    for (const w of items) {
      if (!w.parts) continue;
      lines.push('');
      lines.push(`### ${w.label}　${fmtSize(w.size)}`);
      lines.push('');
      lines.push('| 子项 | 体积 |');
      lines.push('|---|---:|');
      for (const p of w.parts) { if (p.bytes > 0) lines.push(`| ${p.name} | ${fmtSize(p.bytes)} |`); }
    }
    await showMarkdown('总览报告', lines);
  });

  // ---------- 清理重复副本 ----------
  reg('wsManager.cleanDuplicates', async () => {
    const busy = vscode.window.setStatusBarMessage('$(sync~spin) 正在比对会话指纹…');
    let r;
    try {
      r = dup.findDuplicates(provider.state.items);
    } finally {
      busy.dispose();
    }
    if (!r.groups.length) {
      return void vscode.window.showInformationMessage(`已比对 ${r.scanned} 个会话文件，没有发现重复。`);
    }

    // 每组【保留一份】，其余列为待删候选（默认全选）。
    // 保留优先级：① 当前窗口的工作区（通常才是"主"工作区）② mtime 更早的
    // ⚠️ 不能只按 mtime —— 同步工具用 copy2 保留了原时间戳，两份可能完全同秒
    const cands = [];
    for (const g of r.groups) {
      const sorted = [...g.copies].sort((a, b) =>
        (Number(b.isCurrent) - Number(a.isCurrent)) || (a.mtime - b.mtime)
      );
      for (const c of sorted.slice(1)) cands.push({ ...c, keep: sorted[0] });
    }
    if (!cands.length) {
      return void vscode.window.showInformationMessage('没有可清理的冗余副本。');
    }
    const freed = cands.reduce((s, c) => s + c.size, 0);

    const pick = await vscode.window.showQuickPick(
      cands.map((c) => ({
        label: `$(file) ${c.id.slice(0, 8)}　${fmtSize(c.size)}`,
        description: `删自 ${c.label}`,
        detail: `会保留：${c.keep.label}　${c.keep.file}`,
        picked: true,
        data: c
      })),
      {
        canPickMany: true,
        title: `勾选要删除的冗余副本（共 ${cands.length} 个 / ${fmtSize(freed)}）`,
        placeHolder: '默认全选（每组至少保留一份）'
      }
    );
    if (!pick || !pick.length) return;

    const ok = await vscode.window.showWarningMessage(
      `删除 ${pick.length} 个重复副本（${fmtSize(pick.reduce((s, p) => s + p.data.size, 0))}）？`,
      {
        modal: true,
        detail: [
          pick.slice(0, 10).map((p) => `  ${p.data.label}　${p.data.id.slice(0, 8)}`).join('\n'),
          pick.length > 10 ? `  ... 其余 ${pick.length - 10} 个` : '',
          '',
          '全部移入回收站。每组都保留了最早的那一份，内容不会丢。'
        ].filter(Boolean).join('\n')
      },
      '移到回收站'
    );
    if (ok !== '移到回收站') return;

    let done = 0;
    let fail = 0;
    let realFreed = 0;
    for (const p of pick) {
      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(p.data.file), { useTrash: true });
        done++;
        realFreed += p.data.size;
      } catch { fail++; }
    }

    for (const it of provider.state.items) { it._index = undefined; it._sessions = undefined; }
    provider.refresh();
    vscode.window.showInformationMessage(
      `已删除 ${done} 个副本，释放约 ${fmtSize(realFreed)}${fail ? `（失败 ${fail} 个）` : ''}。`
      + ' 若面板里出现空白项，跑一次「一键修复」即可清掉。'
    );
  });

  // ---------- 修复会话索引（补全被隐藏的会话 / 清理空白项） ----------
  /**
   * 修复/还原后提示重载窗口。
   * 当前工作区**必须**立即重载：本窗口内存里仍是旧索引，
   * 任何时候发生会话变更（发消息 / 新建 / 改标题）都会把旧版本整体写回盘上。
   */
  async function offerReload(msg, mustReload, extra) {
    if (mustReload) {
      const detail = (extra ? extra + '\n\n' : '')
        + '⚠️ 请在**继续聊天之前**重载窗口。\n\n'
        + '本窗口内存里仍是修改前的索引 —— 只要发生任何会话变更（发一条消息 / 新建会话 / 改标题），'
        + '它就会把旧版本整体写回盘上，覆盖掉刚才的修改。';
      const pick = await vscode.window.showInformationMessage(msg, { detail }, '立即重载窗口');
      if (pick === '立即重载窗口') {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
      return;
    }
    // 改动不涉及当前窗口 → 不打扰，但要提醒「那边若开着，别接着聊」
    vscode.window.showInformationMessage(msg, {
      detail: (extra ? extra + '\n\n' : '')
        + '如果涉及的工作区正开在其它窗口：请在那边**继续聊天之前**重载窗口，'
        + '否则它的旧索引会把这次修改覆盖掉。没开着的话不用管。'
    });
  }

  reg('wsManager.repairIndex', async (node) => {
    let w = unwrap(node);
    if (!w || !w.dir) {
      const pick = await vscode.window.showQuickPick(
        provider.state.items.map((i) => ({ label: i.label, description: i.folderDisplay, data: i })),
        { title: '选择要修复索引的工作区' }
      );
      if (!pick) return;
      w = pick.data;
    }

    const p = await repair.plan(w);
    if (!p.ok) return void vscode.window.showErrorMessage(`读取索引失败：${p.error}`);

    const detail = [
      `索引条目 ${Object.keys(p.entries).length}（其中外部会话 ${p.external.length} 条，实体在 agentSessionData，永不清理）`,
      `会话文件 ${p.files.length}　→　可见 ${p.visible.length}　孤儿 ${p.orphan.length}　幽灵条目 ${p.ghost.length}`,
      '',
      `✅ 补进索引：${p.toAdd.length} 条（${fmtSize(p.bytesAdded)}）`,
      `⏭ 跳过空壳：${p.skipped.length} 条（小于 ${p.minBytes} 字节，补回去只会是空白项）`,
      `🧹 清除幽灵条目：${p.toRemove.length} 条`,
      '',
      '写入前会自动备份 state.vscdb（.wsmgr-bak-<时间戳>，可用「还原索引备份」回退）。',
      w.isCurrent
        ? '⚠️ 这是当前工作区 —— 写入后请立即重载窗口（会直接给你按钮），否则内存里的旧索引会覆盖本次修复。'
        : '本操作只增删索引条目，不会删除任何会话文件。'
    ].join('\n');

    const pick = await vscode.window.showWarningMessage(
      `修复「${w.label}」的会话索引？`,
      { modal: true, detail },
      '开始修复'
    );
    if (pick !== '开始修复') return;

    // allowCurrent + currentDbPath=null：对当前工作区也写盘，由随后的「立即重载」兜住
    const r = await repair.apply(w, p, { allowCurrent: true, currentDbPath: null });
    if (!r.ok) return void vscode.window.showErrorMessage(`修复失败：${r.error}`);
    provider.refresh();

    if (r.added === 0 && r.removed === 0) {
      return void vscode.window.showInformationMessage(
        `「${w.label}」无需改动：索引与文件已经对得上（没有孤儿也没有幽灵）。`
      );
    }
    await offerReload(
      `已修复「${w.label}」：补入 ${r.added} 条，清除 ${r.removed} 条，索引现有 ${r.total} 条。`,
      w.isCurrent
    );
  });

  // ---------- 清理空会话（从未发过消息 · 走回收站） ----------
  reg('wsManager.cleanEmptySessions', async (node) => {
    let w = unwrap(node);
    if (!w || !w.dir) {
      const pick = await vscode.window.showQuickPick(
        provider.state.items.map((i) => ({ label: i.label, description: i.folderDisplay, data: i })),
        { title: '选择要清理空会话的工作区' }
      );
      if (!pick) return;
      w = pick.data;
    }

    const p = await repair.plan(w);
    if (!p.ok) return void vscode.window.showErrorMessage(`读取索引失败：${p.error}`);
    const empties = [...p.emptyVisible, ...p.emptyOrphans];
    if (!empties.length) return void vscode.window.showInformationMessage(`「${w.label}」里没有确认空的会话。`);

    const preview = empties.slice(0, 12)
      .map((f) => `  ${new Date(f.mtime).toLocaleString()}　${f.id.slice(0, 8)}　${f.size} B`)
      .join('\n');
    const detail = [
      '判定依据：会话文件的 requests 数组为空（从未发出过任何消息）—— 不是看标题或大小猜的。',
      '',
      `共 ${empties.length} 条，合计 ${fmtSize(empties.reduce((s, f) => s + f.size, 0))}：`,
      `  · ${p.emptyVisible.length} 条在索引里（面板本来也不显示它们）`,
      `  · ${p.emptyOrphans.length} 条是孤儿（索引里也没有）`,
      '',
      preview,
      empties.length > 12 ? `  ... 其余 ${empties.length - 12} 条` : '',
      '',
      '全部移入回收站。**有内容的会话一律不动**。'
    ].filter(Boolean).join('\n');

    const pick = await vscode.window.showWarningMessage(
      `删除「${w.label}」中 ${empties.length} 条空会话？`,
      { modal: true, detail },
      '移到回收站'
    );
    if (pick !== '移到回收站') return;

    let ok = 0;
    let fail = 0;
    for (const f of empties) {
      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(f.file), { useTrash: true });
        ok++;
      } catch { fail++; }
    }

    // 失效缓存，让树重扫
    w._index = undefined;
    w._sessions = undefined;
    provider.refresh();

    vscode.window.showInformationMessage(
      `已移入回收站 ${ok} 条${fail ? `，失败 ${fail} 条` : ''}。`
      + `索引里会残留 ${ok} 条已无文件的条目 —— 换个窗口用「一键修复」即可清掉。`
    );
  });

  // ---------- 一键修复：清空会话 + 补孤儿 + 清幽灵 ----------
  reg('wsManager.repairAll', async (node) => {
    let w = unwrap(node);
    if (!w || !w.dir) {
      const pick = await vscode.window.showQuickPick(
        provider.state.items.map((i) => ({ label: i.label, description: i.folderDisplay, data: i })),
        { title: '选择要修复的工作区' }
      );
      if (!pick) return;
      w = pick.data;
    }

    const first = await repair.plan(w);
    if (!first.ok) return void vscode.window.showErrorMessage(`读取索引失败：${first.error}`);
    const empties = [...first.emptyVisible, ...first.emptyOrphans];

    const detail = [
      '判定依据：空会话 = 会话文件里 requests 数组为空（从未发出过任何一条消息），不是看标题。',
      '',
      `① 清除空会话：${empties.length} 条（${fmtSize(empties.reduce((s, f) => s + f.size, 0))}，进回收站）`,
      `② 补进索引：${first.toAdd.length} 条有内容的孤儿`,
      `③ 清除幽灵：${first.ghost.length} 条无文件的条目`,
      '',
      '写入索引前自动备份 state.vscdb（.wsmgr-bak-<时间戳>，可用「还原索引备份」回退）。',
      w.isCurrent
        ? '⚠️ 这是当前工作区 —— 完成后请立即重载窗口（会直接给按钮），否则内存里的旧索引会覆盖本次修复。'
        : '',
      '',
      '不会删除任何有内容的会话。'
    ].filter(Boolean).join('\n');

    const pick = await vscode.window.showWarningMessage(
      `一键修复「${w.label}」？`,
      { modal: true, detail },
      '开始修复'
    );
    if (!pick) return;

    // ① 清空会话（走回收站）
    let delOk = 0;
    let delFail = 0;
    for (const f of empties) {
      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(f.file), { useTrash: true });
        delOk++;
      } catch { delFail++; }
    }

    // ② 索引 —— 必须重新 plan：文件刚被删掉了
    let idxMsg;
    const p2 = await repair.plan(w);
    if (!p2.ok) {
      idxMsg = `读取索引失败：${p2.error}`;
    } else {
      const r = await repair.apply(w, p2, { allowCurrent: true, currentDbPath: null });
      idxMsg = r.ok ? `补入 ${r.added} 条、清除 ${r.removed} 条，现有 ${r.total} 条` : `失败：${r.error}`;
    }

    w._index = undefined;
    w._sessions = undefined;
    provider.refresh();

    await offerReload(
      `「${w.label}」修复完成：删除空会话 ${delOk} 条${delFail ? `（失败 ${delFail}）` : ''}　｜　索引 ${idxMsg}`,
      w.isCurrent
    );
  });

  // ---------- 跨工作区复制 / 移动会话 ----------
  async function transferSelected(mode) {
    const sel = view.selection.filter((s) => s.kind === 'session').map((s) => s.data);
    if (!sel.length) {
      return void vscode.window.showWarningMessage('请先在「会话」分组里选中至少一条会话（可 Ctrl / Shift 多选）。');
    }

    // 反查这些会话属于哪个工作区
    const srcCsDir = path.dirname(sel[0].file);
    const source = provider.state.items.find((i) => path.join(i.dir, 'chatSessions') === srcCsDir);
    if (!source) return void vscode.window.showErrorMessage('找不到这些会话所属的工作区。');

    // 目标候选：只需排除源自己（写当前工作区的索引也可以，靠随后的「立即重载」兜住）
    const cands = provider.state.items.filter((i) => i.dir !== source.dir);
    if (!cands.length) return void vscode.window.showWarningMessage('没有其它工作区可作为目标。');

    const verb = mode === 'move' ? '移动' : '复制';
    const pick = await vscode.window.showQuickPick(
      cands.map((i) => ({
        label: i.label,
        description: `${i.folderDisplay}　已有 ${i.sessionFiles.length} 条`,
        data: i
      })),
      { title: `把选中的 ${sel.length} 条会话${verb}到…`, placeHolder: '选择目标工作区' }
    );
    if (!pick) return;
    const target = pick.data;

    const p = await transfer.plan(sel.map((s) => s.id), source, target);
    if (!p.ok) return void vscode.window.showErrorMessage(p.error);
    if (!p.toCopy.length) {
      return void vscode.window.showWarningMessage(
        '没有可搬运的会话'
        + (p.conflicts.length ? `（${p.conflicts.length} 条在目标已存在）` : '')
        + (p.missing.length ? `（${p.missing.length} 条文件缺失）` : '') + '。'
      );
    }

    const detail = [
      `源：${source.folderDisplay}`,
      `目标：${target.folderDisplay}`,
      '',
      `将${verb} ${p.toCopy.length} 条会话（${fmtSize(p.bytes)}）`,
      p.conflicts.length ? `跳过 ${p.conflicts.length} 条（目标已有同 ID）` : '',
      p.missing.length ? `缺失 ${p.missing.length} 条（文件不存在）` : '',
      '',
      mode === 'move'
        ? '源文件会移入回收站。⚠️ 若源是当前工作区，其索引条目会残留（面板里表现为空白项），稍后用「一键修复」清掉即可。'
        : '源会话不受任何影响。'
    ].filter(Boolean).join('\n');

    const ok = await vscode.window.showWarningMessage(
      `确认${verb}这 ${p.toCopy.length} 条会话？`,
      { modal: true, detail },
      `开始${verb}`
    );
    if (ok !== `开始${verb}`) return;

    // ① 复制文件（这一步失败不会留下副作用）
    const done = [];
    const failCopy = [];
    for (const it of p.toCopy) {
      try {
        await vscode.workspace.fs.copy(vscode.Uri.file(it.src), vscode.Uri.file(it.dest), { overwrite: false });
        done.push(it);
      } catch (e) {
        failCopy.push({ id: it.id, error: e.message });
      }
    }

    // ② 目标索引登记（currentDbPath=null：允许写当前工作区，随后用重载兜住）
    const reg = done.length
      ? await transfer.registerInTarget(target, done, null)
      : { ok: false, error: '没有成功复制的文件' };

    // ③ 移动：删源文件（回收站）→ 源索引注销
    let delOk = 0;
    let delFail = 0;
    let unregMsg = '';
    if (mode === 'move' && done.length) {
      for (const it of done) {
        try {
          await vscode.workspace.fs.delete(vscode.Uri.file(it.src), { useTrash: true });
          delOk++;
        } catch { delFail++; }
      }
      const u = await transfer.unregisterFromSource(source, done.map((x) => x.id), null);
      unregMsg = u.ok ? `源索引已注销 ${u.removed} 条` : `源索引注销失败：${u.error}`;
    }

    source._index = undefined;
    source._sessions = undefined;
    target._index = undefined;
    target._sessions = undefined;
    provider.refresh();

    const lines = [
      `复制文件 ${done.length} 条${failCopy.length ? `，失败 ${failCopy.length} 条` : ''}`,
      `目标索引：${reg.ok ? `登记 ${reg.added} 条` : reg.error}`
    ];
    if (mode === 'move') {
      lines.push(`源文件：移入回收站 ${delOk} 条${delFail ? `，失败 ${delFail} 条` : ''}`);
      lines.push(unregMsg);
    }
    await offerReload(
      `已${verb}到「${target.label}」`,
      source.isCurrent || target.isCurrent,
      lines.join('\n')
    );
  }

  reg('wsManager.copySessionsTo', () => transferSelected('copy'));
  reg('wsManager.moveSessionsTo', () => transferSelected('move'));

  // ---------- 还原索引备份 ----------
  reg('wsManager.restoreIndexBackup', async (node) => {
    let w = unwrap(node);
    if (!w || !w.dir) {
      const pick = await vscode.window.showQuickPick(
        provider.state.items.map((i) => ({ label: i.label, description: i.folderDisplay, data: i })),
        { title: '选择要还原索引备份的工作区' }
      );
      if (!pick) return;
      w = pick.data;
    }

    const b = repair.getBackup(w.dir);
    if (!b) {
      return void vscode.window.showInformationMessage(
        `「${w.label}」没有备份可还原 —— 备份在每次修复索引或搬运会话时生成一份。`
      );
    }

    const ok = await vscode.window.showWarningMessage(
      `把「${w.label}」的索引还原到备份状态？`,
      {
        modal: true,
        detail: [
          `备份时间：${new Date(b.when).toLocaleString()}（${fmtSize(b.size)}）`,
          '',
          '这是**交换**操作：当前索引会被写进备份文件，所以再点一次「还原索引备份」就能换回去。',
          '只影响索引条目，会话数据文件不受任何影响。'
        ].join('\n')
      },
      '还原'
    );
    if (ok !== '还原') return;

    const r = repair.restoreBackup(w.dir);
    if (!r.ok) return void vscode.window.showErrorMessage(`还原失败：${r.error}`);

    w._index = undefined;
    w._sessions = undefined;
    provider.refresh();
    await offerReload(
      `已还原「${w.label}」的索引`,
      w.isCurrent,
      '备份里现在是还原前的状态 —— 再执行一次「还原索引备份」即可换回。'
    );
  });

  // ---------- 清理可重建的缓存 ----------
  reg('wsManager.cleanCache', async (node) => {
    let w = unwrap(node);
    if (!w || !w.dir) {
      const pick = await vscode.window.showQuickPick(
        provider.state.items.map((i) => ({ label: i.label, description: i.folderDisplay, data: i })),
        { title: '选择要清理缓存的工作区' }
      );
      if (!pick) return;
      w = pick.data;
    }

    store.computeSize(w);
    const cands = (w.parts || []).filter((x) => x.bytes > 0 && store.isCleanable(x.name));
    if (!cands.length) {
      return void vscode.window.showInformationMessage(`「${w.label}」没有可清理的缓存。`);
    }

    const total = cands.reduce((s, x) => s + x.bytes, 0);
    const detail = [
      cands.map((x) => `  ${fmtSize(x.bytes).padStart(10)}　${x.name}`).join('\n'),
      '',
      `合计 ${fmtSize(total)}，全部移入回收站。`,
      '',
      '这些是各扩展的工作区缓存（含本扩展旧格式的索引备份），删后首次打开对应工作区会重建 —— 可能慢一次，**不会丢会话**。',
      '会话数据（chatSessions）、索引本体（state.vscdb）、当前那份额外的索引备份都不会被动。'
    ].join('\n');

    const ok = await vscode.window.showWarningMessage(
      `清理「${w.label}」中 ${cands.length} 项缓存？`,
      { modal: true, detail },
      '移到回收站'
    );
    if (ok !== '移到回收站') return;

    let done = 0;
    let fail = 0;
    let freed = 0;
    for (const x of cands) {
      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(path.join(w.dir, x.name)), { recursive: true, useTrash: true });
        done++;
        freed += x.bytes;
      } catch { fail++; }
    }

    w.parts = null;
    w.size = null;
    provider.refresh();
    await sizeAll();
    vscode.window.showInformationMessage(
      `已清理 ${done} 项缓存，释放约 ${fmtSize(freed)}${fail ? `（失败 ${fail} 项）` : ''}。`
    );
  });

  // ---------- 删除（仅显式触发 + 二次确认 + 回收站） ----------
  reg('wsManager.deleteWorkspace', async (node) => {
    const w = unwrap(node);
    if (!w) return;

    if (w.isCurrent) {
      return void vscode.window.showWarningMessage(
        '当前工作区正被 VS Code 占用（state.vscdb 是活的连接），不能删除。'
      );
    }
    const reason = store.suggestReason(w);
    const detail = [
      `目录：${w.folderPath || '（无 workspace.json）'}`,
      `体积：${w.size === null ? '未知' : fmtSize(w.size)}　　会话：${w.sessionFiles.length} 条`,
      `存储位置：${w.dir}`,
      '',
      '删除后：该目录下所有会话、缓存、UI 状态一并进入回收站；再次打开该目录时会重新生成一个空存储。'
    ].join('\n');
    const pick = await vscode.window.showWarningMessage(
      `删除「${w.label}」的工作区存储？`,
      { modal: true, detail: (reason ? `⚠️ 建议理由：${reason}\n\n` : '') + detail },
      '移到回收站'
    );
    if (pick !== '移到回收站') return;

    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(w.dir), { recursive: true, useTrash: true });
      provider.refresh();
      vscode.window.showInformationMessage(`已移到回收站：${w.label}`);
    } catch (e) {
      vscode.window.showErrorMessage(`删除失败：${e.message}`);
    }
  });

  reg('wsManager.deleteSession', async (node) => {
    // 支持多选：优先取选中集，为空时退回右键的那一个
    let targets = view.selection.filter((s) => s.kind === 'session').map((s) => s.data);
    if (!targets.length) {
      const one = unwrap(node);
      if (one && one.file) targets = [one];
    }
    targets = targets.filter((t) => t && t.file);
    if (!targets.length) return;

    const n = targets.length;
    const preview = targets.slice(0, 10).map((t) => `  ${t.title || t.id.slice(0, 8)}`).join('\n');
    const pick = await vscode.window.showWarningMessage(
      n === 1 ? `删除会话「${targets[0].title || targets[0].id.slice(0, 8)}」？` : `删除选中的 ${n} 条会话？`,
      {
        modal: true,
        detail: [
          preview,
          n > 10 ? `  ... 其余 ${n - 10} 条` : '',
          '',
          '全部移入回收站。',
          '注意：只删除数据文件，索引里会残留对应的空条目（面板里表现为空白项）—— 跑一次「一键修复」即可清掉。'
        ].filter(Boolean).join('\n')
      },
      '移到回收站'
    );
    if (pick !== '移到回收站') return;

    let ok = 0;
    let fail = 0;
    for (const t of targets) {
      try {
        await vscode.workspace.fs.delete(vscode.Uri.file(t.file), { useTrash: true });
        ok++;
      } catch { fail++; }
    }

    for (const it of provider.state.items) { it._index = undefined; it._sessions = undefined; }
    provider.refresh();
    vscode.window.showInformationMessage(
      `已移入回收站 ${ok} 条${fail ? `，失败 ${fail} 条` : ''}。`
      + '若面板里出现空白项，跑一次「一键修复」即可清掉。'
    );
  });

  // 启动后台算体积（延后，避免和窗口初始化抢 IO）
  setTimeout(sizeAll, 1500);
}

function deactivate() { }

module.exports = { activate, deactivate };
