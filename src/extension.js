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
const { t } = require('./l10n');

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

  // 按钮文案提成常量：按钮数组与 `if (ok !== X)` 用同一个值，避免改语言时两处漂移
  // （曾经是字面量各写一遍，只改一处就会让删除确认静默失效）
  const BTN_TRASH = t('Move to Recycle Bin');
  const BTN_REPAIR = t('Start repair');
  const BTN_RESTORE = t('Restore');
  const BTN_RELOAD = t('Reload Window Now');
  const idxErr = (e) => t('Failed to read the index: {0}', e);

  const reg = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));

  // ---------- 体积计算（后台、分批、可中断） ----------
  async function sizeAll() {
    const pending = provider.state.items.filter((i) => i.size === null).length;
    if (!pending) return;
    bar.show();
    try {
      await provider.computeAllSizes((done, total) => {
        bar.text = t('$(sync~spin) Calculating workspace sizes {0}/{1}', done, total);
      });
      bar.text = t('$(check) Workspace sizes updated');
      setTimeout(() => bar.hide(), 4000);
    } catch {
      bar.text = t('$(warning) Size calculation interrupted');
      setTimeout(() => bar.hide(), 4000);
    }
  }

  reg('wsManager.refresh', async () => {
    provider.refresh();
    const n = provider.state.items.length;
    const cur = provider.state.items.find((i) => i.isCurrent);
    vscode.window.setStatusBarMessage(
      t('Workspace Manager: {0} workspaces{1}', n, cur ? t(', current {0}', cur.label) : ''), 3000
    );
    await sizeAll();
  });

  // ---------- 打开 / 定位 / 复制 ----------
  reg('wsManager.openWorkspace', (node) => {
    const w = unwrap(node);
    if (!w || !w.folderPath) return void vscode.window.showWarningMessage(t('This entry has no usable folder path.'));
    if (!w.folderExists) return void vscode.window.showWarningMessage(t('Folder does not exist: {0}', w.folderPath));
    vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(w.folderPath), { forceNewWindow: true });
  });

  reg('wsManager.revealFolder', (node) => {
    const w = unwrap(node);
    if (!w || !w.folderExists) return void vscode.window.showWarningMessage(t('Folder does not exist; cannot reveal it.'));
    vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(w.folderPath));
  });

  reg('wsManager.copyPath', async (node) => {
    const w = unwrap(node);
    const text = w && (w.folderPath || w.dir);
    if (!text) return;
    await vscode.env.clipboard.writeText(text);
    vscode.window.setStatusBarMessage(t('Copied: {0}', text), 3000);
  });

  // ---------- 查找重复会话（跨工作区） ----------
  reg('wsManager.findDuplicates', async () => {
    const busy = vscode.window.setStatusBarMessage(t('$(sync~spin) Comparing session fingerprints…'));
    let r;
    try {
      r = dup.findDuplicates(provider.state.items);
    } finally {
      busy.dispose();
    }

    if (!r.groups.length) {
      return void vscode.window.showInformationMessage(
        t('Compared {0} session files; no duplicates found.', r.scanned)
      );
    }

    const lines = [];
    lines.push(t('# Duplicate sessions'));
    lines.push('');
    lines.push(t('> Compared {0} session files (fingerprint = file size + SHA-1 of the first 64 KB)', r.scanned));
    lines.push(t('> Found **{0} groups** of duplicates, about **{1}** wasted', r.groups.length, fmtSize(r.bytes)));
    lines.push('');
    lines.push(t('**This report deletes nothing.** Keep one copy per group to reclaim the waste.'));
    lines.push('');
    for (const g of r.groups) {
      const wasted = g.size * (g.copies.length - 1);
      lines.push(t('## {0} × {1}　— {2} wasted{3}', fmtSize(g.size), g.copies.length, fmtSize(wasted), g.sameId ? '' : t('　⚠️ different IDs, same content')));
      lines.push('');
      for (const c of g.copies) {
        lines.push(`- ${c.isCurrent ? '🟢 ' : ''}**${c.label}**　\`${c.id}\`　${c.file}`);
      }
      lines.push('');
    }
    await showMarkdown('duplicates', lines);
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
    lines.push(t('# workspaceStorage overview'));
    lines.push('');
    lines.push(t('> Generated {0}　｜　{1} entries', new Date().toLocaleString(), items.length));
    lines.push('');
    lines.push(t('| | Workspace | Folder exists | Size | Sessions | Last used | Suggestion |'));
    lines.push('|---|---|---|---:|---:|---|---|');
    for (const w of items) {
      const reason = store.suggestReason(w) || '';
      const existsCell = w.remote ? t('🌐remote') : (w.folderExists ? '✅' : '❌');
      lines.push(t('| {0} | `{1}` | {2} | {3} | {4} | {5} | {6} |', w.isCurrent ? t('🟢current') : '', w.folderDisplay || w.label, existsCell, w.size === null ? '—' : fmtSize(w.size), w.sessionFiles.length, fmtDate(w.mtime), reason || ''));
    }
    lines.push('');
    lines.push(t('## Size breakdown'));
    for (const w of items) {
      if (!w.parts) continue;
      lines.push('');
      lines.push(`### ${w.label}　${fmtSize(w.size)}`);
      lines.push('');
      lines.push(t('| Item | Size |'));
      lines.push('|---|---:|');
      for (const p of w.parts) { if (p.bytes > 0) lines.push(`| ${p.name} | ${fmtSize(p.bytes)} |`); }
    }
    await showMarkdown('overview', lines);
  });

  // ---------- 清理重复副本 ----------
  reg('wsManager.cleanDuplicates', async () => {
    const busy = vscode.window.setStatusBarMessage(t('$(sync~spin) Comparing session fingerprints…'));
    let r;
    try {
      r = dup.findDuplicates(provider.state.items);
    } finally {
      busy.dispose();
    }
    if (!r.groups.length) {
      return void vscode.window.showInformationMessage(t('Compared {0} session files; no duplicates found.', r.scanned));
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
      return void vscode.window.showInformationMessage(t('No redundant copies to clean.'));
    }
    const freed = cands.reduce((s, c) => s + c.size, 0);

    const pick = await vscode.window.showQuickPick(
      cands.map((c) => ({
        label: `$(file) ${c.id.slice(0, 8)}　${fmtSize(c.size)}`,
        description: t('Also in {0}', c.label),
        detail: t('Keeping: {0}　{1}', c.keep.label, c.keep.file),
        picked: true,
        data: c
      })),
      {
        canPickMany: true,
        title: t('Select the redundant copies to delete ({0} selected / {1})', cands.length, fmtSize(freed)),
        placeHolder: t('All preselected (each group keeps at least one)')
      }
    );
    if (!pick || !pick.length) return;

    const ok = await vscode.window.showWarningMessage(
      t('Delete {0} duplicate copies ({1})?', pick.length, fmtSize(pick.reduce((s, p) => s + p.data.size, 0))),
      {
        modal: true,
        detail: [
          pick.slice(0, 10).map((p) => `  ${p.data.label}　${p.data.id.slice(0, 8)}`).join('\n'),
          pick.length > 10 ? t('  ... {0} more', pick.length - 10) : '',
          '',
          t('All go to the Recycle Bin. The earliest copy of each group is kept, so nothing is lost.')
        ].filter(Boolean).join('\n')
      },
      BTN_TRASH
    );
    if (ok !== BTN_TRASH) return;

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
      t('Deleted {0} copies, freed about {1}{2}.', done, fmtSize(realFreed), fail ? t(' ({0} failed)', fail) : '')
      + ' ' + t('If blank items show up in the panel, run "One-Click Repair" once to clear them.')
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
        + t('⚠️ Reload the window **before you keep chatting**.') + '\n\n'
        + t('This window still holds the pre-change index in memory — any session change (send a message / create a session / rename one)')
        + t(' writes the old copy back to disk and overwrites what was just fixed.');
      const pick = await vscode.window.showInformationMessage(msg, { detail }, BTN_RELOAD);
      if (pick === BTN_RELOAD) {
        await vscode.commands.executeCommand('workbench.action.reloadWindow');
      }
      return;
    }
    // 改动不涉及当前窗口 → 不打扰，但要提醒「那边若开着，别接着聊」
    vscode.window.showInformationMessage(msg, {
      detail: (extra ? extra + '\n\n' : '')
        + t('If the affected workspace is open in another window, reload it there **before you keep chatting**,')
        + t(' otherwise its stale index would overwrite this change. Ignore this if it is not open.')
    });
  }

  reg('wsManager.repairIndex', async (node) => {
    let w = unwrap(node);
    if (!w || !w.dir) {
      const pick = await vscode.window.showQuickPick(
        provider.state.items.map((i) => ({ label: i.label, description: i.folderDisplay, data: i })),
        { title: t('Pick the workspace whose index to repair') }
      );
      if (!pick) return;
      w = pick.data;
    }

    const p = await repair.plan(w);
    if (!p.ok) return void vscode.window.showErrorMessage(idxErr(p.error));

    const detail = [
      t('Index entries: {0} ({1} of them external sessions, whose data lives in agentSessionData and is never cleaned)', Object.keys(p.entries).length, p.external.length),
      t('Session files: {0}　→　visible {1}　orphaned {2}　ghost entries {3}', p.files.length, p.visible.length, p.orphan.length, p.ghost.length),
      '',
      t('✅ Add to the index: {0} ({1})', p.toAdd.length, fmtSize(p.bytesAdded)),
      t('⏭ Skip empty shells: {0} (under {1} bytes; restoring them would only add blank items)', p.skipped.length, p.minBytes),
      t('🧹 Remove ghost entries: {0}', p.toRemove.length),
      '',
      t('state.vscdb is backed up automatically before writing (.wsmgr-bak-<timestamp>; roll back with "Restore Index Backup").'),
      w.isCurrent
        ? t('⚠️ This is the current workspace — reload the window right after writing (a button is offered), otherwise the old in-memory index will overwrite this repair.')
        : t('This only adds/removes index entries; no session file is ever deleted.')
    ].join('\n');

    const pick = await vscode.window.showWarningMessage(
      t('Repair the session index of "{0}"?', w.label),
      { modal: true, detail },
      BTN_REPAIR
    );
    if (pick !== BTN_REPAIR) return;

    // allowCurrent + currentDbPath=null：对当前工作区也写盘，由随后的「立即重载」兜住
    const r = await repair.apply(w, p, { allowCurrent: true, currentDbPath: null });
    if (!r.ok) return void vscode.window.showErrorMessage(t('Repair failed: {0}', r.error));
    provider.refresh();

    if (r.added === 0 && r.removed === 0) {
      return void vscode.window.showInformationMessage(
        t('"{0}" needs no changes: the index and the files already agree (no orphans, no ghosts).', w.label)
      );
    }
    await offerReload(
      t('Repaired "{0}": {1} added, {2} removed, {3} entries now.', w.label, r.added, r.removed, r.total),
      w.isCurrent
    );
  });

  // ---------- 清理空会话（从未发过消息 · 走回收站） ----------
  reg('wsManager.cleanEmptySessions', async (node) => {
    let w = unwrap(node);
    if (!w || !w.dir) {
      const pick = await vscode.window.showQuickPick(
        provider.state.items.map((i) => ({ label: i.label, description: i.folderDisplay, data: i })),
        { title: t('Pick the workspace whose empty sessions to clean') }
      );
      if (!pick) return;
      w = pick.data;
    }

    const p = await repair.plan(w);
    if (!p.ok) return void vscode.window.showErrorMessage(idxErr(p.error));
    const empties = [...p.emptyVisible, ...p.emptyOrphans];
    if (!empties.length) return void vscode.window.showInformationMessage(t('"{0}" has no confirmed-empty sessions.', w.label));

    const preview = empties.slice(0, 12)
      .map((f) => `  ${new Date(f.mtime).toLocaleString()}　${f.id.slice(0, 8)}　${f.size} B`)
      .join('\n');
    const detail = [
      t('Basis: the session file has an empty requests array (not a single message was ever sent) — this is not guessed from the title or size.'),
      '',
      t('{0} in total, {1}:', empties.length, fmtSize(empties.reduce((s, f) => s + f.size, 0))),
      t('  · {0} are in the index (the panel never showed them anyway)', p.emptyVisible.length),
      t('  · {0} are orphaned (not in the index either)', p.emptyOrphans.length),
      '',
      preview,
      empties.length > 12 ? t('  ... {0} more', empties.length - 12) : '',
      '',
      t('All go to the Recycle Bin. **Sessions with content are never touched**.')
    ].filter(Boolean).join('\n');

    const pick = await vscode.window.showWarningMessage(
      t('Delete {1} empty sessions from "{0}"?', w.label, empties.length),
      { modal: true, detail },
      BTN_TRASH
    );
    if (pick !== BTN_TRASH) return;

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
      t('Moved {0} to the Recycle Bin{1}.', ok, fail ? t(' ({0} failed)', fail) : '')
      + t(' {0} entries in the index now point at missing files — switch to another window and run "One-Click Repair" to clear them.', ok)
    );
  });

  // ---------- 一键修复：清空会话 + 补孤儿 + 清幽灵 ----------
  reg('wsManager.repairAll', async (node) => {
    let w = unwrap(node);
    if (!w || !w.dir) {
      const pick = await vscode.window.showQuickPick(
        provider.state.items.map((i) => ({ label: i.label, description: i.folderDisplay, data: i })),
        { title: t('Pick the workspace to repair') }
      );
      if (!pick) return;
      w = pick.data;
    }

    const first = await repair.plan(w);
    if (!first.ok) return void vscode.window.showErrorMessage(idxErr(first.error));
    const empties = [...first.emptyVisible, ...first.emptyOrphans];

    const detail = [
      t('Basis: an empty session is one whose requests array is empty (not a single message was ever sent) — not a guess from the title.'),
      '',
      t('① Remove empty sessions: {0} ({1}, to the Recycle Bin)', empties.length, fmtSize(empties.reduce((s, f) => s + f.size, 0))),
      t('② Add to the index: {0} orphaned sessions that have content', first.toAdd.length),
      t('③ Remove ghosts: {0} entries with no file', first.ghost.length),
      '',
      t('state.vscdb is backed up automatically before writing (.wsmgr-bak-<timestamp>; roll back with "Restore Index Backup").'),
      w.isCurrent
        ? t('⚠️ This is the current workspace — reload the window right after (a button is offered), otherwise the old in-memory index will overwrite this repair.')
        : '',
      '',
      t('No session with content is ever deleted.')
    ].filter(Boolean).join('\n');

    const pick = await vscode.window.showWarningMessage(
      t('One-click repair of "{0}"?', w.label),
      { modal: true, detail },
      BTN_REPAIR
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
      idxMsg = idxErr(p2.error);
    } else {
      const r = await repair.apply(w, p2, { allowCurrent: true, currentDbPath: null });
      idxMsg = r.ok ? t('{0} added, {1} removed, {2} entries now', r.added, r.removed, r.total) : t('failed: {0}', r.error);
    }

    w._index = undefined;
    w._sessions = undefined;
    provider.refresh();

    await offerReload(
      t('Repaired "{0}": {1} empty sessions deleted{2}　｜　index {3}', w.label, delOk, delFail ? t(' ({0} failed)', delFail) : '', idxMsg),
      w.isCurrent
    );
  });

  // ---------- 跨工作区复制 / 移动会话 ----------
  async function transferSelected(mode) {
    const sel = view.selection.filter((s) => s.kind === 'session').map((s) => s.data);
    if (!sel.length) {
      return void vscode.window.showWarningMessage(t('Select at least one session in the "Sessions" group first (Ctrl / Shift for multi-select).'));
    }

    // 反查这些会话属于哪个工作区
    const srcCsDir = path.dirname(sel[0].file);
    const source = provider.state.items.find((i) => path.join(i.dir, 'chatSessions') === srcCsDir);
    if (!source) return void vscode.window.showErrorMessage(t('Could not find the workspace these sessions belong to.'));

    // 目标候选：只需排除源自己（写当前工作区的索引也可以，靠随后的「立即重载」兜住）
    const cands = provider.state.items.filter((i) => i.dir !== source.dir);
    if (!cands.length) return void vscode.window.showWarningMessage(t('No other workspace can be a target.'));

    const isMove = mode === 'move';
    const pick = await vscode.window.showQuickPick(
      cands.map((i) => ({
        label: i.label,
        description: t('{0}　{1} sessions already', i.folderDisplay, i.sessionFiles.length),
        data: i
      })),
      {
        title: isMove
          ? t('Move {0} selected sessions to…', sel.length)
          : t('Copy {0} selected sessions to…', sel.length),
        placeHolder: t('Choose the target workspace')
      }
    );
    if (!pick) return;
    const target = pick.data;

    const p = await transfer.plan(sel.map((s) => s.id), source, target);
    if (!p.ok) return void vscode.window.showErrorMessage(p.error);
    if (!p.toCopy.length) {
      return void vscode.window.showWarningMessage(
        t('Nothing to transfer')
        + (p.conflicts.length ? t(' ({0} already exist in the target)', p.conflicts.length) : '')
        + (p.missing.length ? t(' ({0} files are missing)', p.missing.length) : '') + '.'
      );
    }

    const detail = [
      t('Source: {0}', source.folderDisplay),
      t('Target: {0}', target.folderDisplay),
      '',
      isMove
        ? t('Moves {0} sessions ({1})', p.toCopy.length, fmtSize(p.bytes))
        : t('Copies {0} sessions ({1})', p.toCopy.length, fmtSize(p.bytes)),
      p.conflicts.length ? t('Skip {0} (the target already has the same ID)', p.conflicts.length) : '',
      p.missing.length ? t('Missing {0} (file not found)', p.missing.length) : '',
      '',
      isMove
        ? t('Source files go to the Recycle Bin. ⚠️ If the source is the current workspace its index entries remain (they show up as blank items); run "One-Click Repair" later to clear them.')
        : t('The source sessions are not affected at all.')
    ].filter(Boolean).join('\n');

    const btnGo = isMove ? t('Start moving') : t('Start copying');
    const ok = await vscode.window.showWarningMessage(
      isMove ? t('Move these {0} sessions?', p.toCopy.length) : t('Copy these {0} sessions?', p.toCopy.length),
      { modal: true, detail },
      btnGo
    );
    if (ok !== btnGo) return;

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
      : { ok: false, error: t('No file was copied successfully') };

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
      unregMsg = u.ok ? t('Source index unregistered: {0}', u.removed) : t('Failed to unregister from the source index: {0}', u.error);
    }

    source._index = undefined;
    source._sessions = undefined;
    target._index = undefined;
    target._sessions = undefined;
    provider.refresh();

    const lines = [
      t('{0} files copied{1}', done.length, failCopy.length ? t(' ({0} failed)', failCopy.length) : ''),
      t('Target index: {0}', reg.ok ? t('{0} registered', reg.added) : reg.error)
    ];
    if (isMove) {
      lines.push(t('Source files: {0} moved to the Recycle Bin{1}', delOk, delFail ? t(' ({0} failed)', delFail) : ''));
      lines.push(unregMsg);
    }
    await offerReload(
      isMove ? t('Moved to "{0}"', target.label) : t('Copied to "{0}"', target.label),
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
        { title: t('Pick the workspace whose index backup to restore') }
      );
      if (!pick) return;
      w = pick.data;
    }

    const b = repair.getBackup(w.dir);
    if (!b) {
      return void vscode.window.showInformationMessage(
        t('"{0}" has no backup to restore — one is created on every index repair or session transfer.', w.label)
      );
    }

    const ok = await vscode.window.showWarningMessage(
      t('Restore the index of "{0}" to its backup?', w.label),
      {
        modal: true,
        detail: [
          t('Backup taken: {0} ({1})', new Date(b.when).toLocaleString(), fmtSize(b.size)),
          '',
          t('This is a **swap**: the current index is written into the backup file, so clicking "Restore Index Backup" again swaps it back.'),
          t('Only index entries are affected; session data files are untouched.')
        ].join('\n')
      },
      BTN_RESTORE
    );
    if (ok !== BTN_RESTORE) return;

    const r = repair.restoreBackup(w.dir);
    if (!r.ok) return void vscode.window.showErrorMessage(t('Restore failed: {0}', r.error));

    w._index = undefined;
    w._sessions = undefined;
    provider.refresh();
    await offerReload(
      t('Restored the index of "{0}"', w.label),
      w.isCurrent,
      t('The backup now holds the state from before the restore — run "Restore Index Backup" once more to swap back.')
    );
  });

  // ---------- 清理可重建的缓存 ----------
  reg('wsManager.cleanCache', async (node) => {
    let w = unwrap(node);
    if (!w || !w.dir) {
      const pick = await vscode.window.showQuickPick(
        provider.state.items.map((i) => ({ label: i.label, description: i.folderDisplay, data: i })),
        { title: t('Pick the workspace whose cache to clean') }
      );
      if (!pick) return;
      w = pick.data;
    }

    store.computeSize(w);
    const cands = (w.parts || []).filter((x) => x.bytes > 0 && store.isCleanable(x.name));
    if (!cands.length) {
      return void vscode.window.showInformationMessage(t('"{0}" has no cleanable cache.', w.label));
    }

    const total = cands.reduce((s, x) => s + x.bytes, 0);
    const detail = [
      cands.map((x) => `  ${fmtSize(x.bytes).padStart(10)}　${x.name}`).join('\n'),
      '',
      t('{0} in total, all moved to the Recycle Bin.', fmtSize(total)),
      '',
      t('These are per-workspace caches of other extensions (plus this extension\'s old-format index backups). They are rebuilt on first open — it may be slow once, **no session is lost**.'),
      t('Session data (chatSessions), the index itself (state.vscdb) and the extra index backup are never touched.')
    ].join('\n');

    const ok = await vscode.window.showWarningMessage(
      t('Clean {1} cache items from "{0}"?', w.label, cands.length),
      { modal: true, detail },
      BTN_TRASH
    );
    if (ok !== BTN_TRASH) return;

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
      t('Cleaned {0} cache items, freed about {1}{2}.', done, fmtSize(freed), fail ? t(' ({0} failed)', fail) : '')
    );
  });

  // ---------- 删除（仅显式触发 + 二次确认 + 回收站） ----------
  reg('wsManager.deleteWorkspace', async (node) => {
    const w = unwrap(node);
    if (!w) return;

    if (w.isCurrent) {
      return void vscode.window.showWarningMessage(
        t('The current workspace is in use by VS Code (state.vscdb is a live connection), so it cannot be deleted.')
      );
    }
    const reason = store.suggestReason(w);
    const detail = [
      t('Folder: {0}', w.folderPath || t('(no workspace.json)')),
      t('Size: {0}　Sessions: {1}', w.size === null ? t('unknown') : fmtSize(w.size), w.sessionFiles.length),
      t('Storage path: {0}', w.dir),
      '',
      t('After deleting: every session, cache and UI state under that folder goes to the Recycle Bin; opening the folder again creates a fresh empty storage.')
    ].join('\n');
    const pick = await vscode.window.showWarningMessage(
      t('Delete the workspace storage of "{0}"?', w.label),
      { modal: true, detail: (reason ? t('⚠️ Suggested because: {0}', reason) + '\n\n' : '') + detail },
      BTN_TRASH
    );
    if (pick !== BTN_TRASH) return;

    try {
      await vscode.workspace.fs.delete(vscode.Uri.file(w.dir), { recursive: true, useTrash: true });
      provider.refresh();
      vscode.window.showInformationMessage(t('Moved to the Recycle Bin: {0}', w.label));
    } catch (e) {
      vscode.window.showErrorMessage(t('Delete failed: {0}', e.message));
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
      n === 1
        ? t('Delete the session "{0}"?', targets[0].title || targets[0].id.slice(0, 8))
        : t('Delete the {0} selected sessions?', n),
      {
        modal: true,
        detail: [
          preview,
          n > 10 ? t('  ... {0} more', n - 10) : '',
          '',
          t('All go to the Recycle Bin.'),
          t('Note: only the data files are deleted, so empty index entries remain (they appear as blank items in the panel) — run "One-Click Repair" once to clear them.')
        ].filter(Boolean).join('\n')
      },
      BTN_TRASH
    );
    if (pick !== BTN_TRASH) return;

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
      t('Moved {0} to the Recycle Bin{1}.', ok, fail ? t(' ({0} failed)', fail) : '')
      + t(' If blank items show up in the panel, run "One-Click Repair" once to clear them.')
    );
  });

  // 启动后台算体积（延后，避免和窗口初始化抢 IO）
  setTimeout(sizeAll, 1500);
}

function deactivate() { }

module.exports = { activate, deactivate };
