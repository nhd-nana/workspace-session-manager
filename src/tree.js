'use strict';
/**
 * tree.js —— 「工作区管家」TreeView。
 *
 * 层级：
 *   工作区节点  →  ├─ 存储明细 → 各子目录/文件体积
 *                 └─ 会话 (N)  → 每条会话
 */
const path = require('path');
const vscode = require('vscode');
const { fmtSize, fmtDate, exists } = require('./util');
const store = require('./store');
const { t } = require('./l10n');

class Node {
  constructor(kind, data) {
    this.kind = kind;      // 'workspace' | 'group-parts' | 'group-sessions' | 'part' | 'session'
    this.data = data;
  }
}

class WorkspaceTreeProvider {
  constructor(context) {
    this.context = context;
    this._onDidChange = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChange.event;
    this.state = { root: null, current: null, items: [] };
  }

  refresh() {
    this.state = store.scan(this.context);
    this._onDidChange.fire();
  }

  /** 后台逐个算体积，算完刷新 */
  async computeAllSizes(onProgress) {
    const pending = this.state.items.filter((i) => i.size === null);
    let done = 0;
    for (const it of pending) {
      store.computeSize(it);
      done++;
      if (onProgress) onProgress(done, pending.length, it.label);
      this._onDidChange.fire();
      await new Promise((r) => setTimeout(r, 0));   // 让出事件循环
    }
  }

  getTreeItem(node) {
    if (node.kind === 'workspace') return this._workspaceItem(node.data);
    if (node.kind === 'group-parts') return this._groupItem(node, t('Storage details'), 'graph');
    if (node.kind === 'group-sessions') {
      const n = node.data.sessionFiles.length;
      const v = store.visibility(node.data);
      const extra = v.known && v.orphan ? t(' · {0} orphaned', v.orphan) : '';
      return this._groupItem(node, t('Sessions ({0}{1})', n, extra), 'comment-discussion');
    }
    if (node.kind === 'group-index') return this._groupItem(node, t('Session index overview'), 'list-tree');
    if (node.kind === 'stat') {
      const it = new vscode.TreeItem(node.data.label, vscode.TreeItemCollapsibleState.None);
      it.iconPath = new vscode.ThemeIcon(node.data.icon || 'info');
      it.description = node.data.desc;
      it.contextValue = 'wsStat';
      return it;
    }
    if (node.kind === 'part') return this._partItem(node.data);
    if (node.kind === 'session') return this._sessionItem(node.data);
    return new vscode.TreeItem('?');
  }

  async getChildren(node) {
    if (!node) {
      return this.state.items.map((w) => new Node('workspace', w));
    }
    if (node.kind === 'workspace') {
      const w = node.data;
      if (!w.size) store.computeSize(w);
      await store.ensureIndex(w);          // 会话可见性依赖索引，先读
      return [
        new Node('group-sessions', w),
        new Node('group-parts', w),
        new Node('group-index', w)
      ];
    }
    if (node.kind === 'group-index') return this._indexRows(node.data);
    if (node.kind === 'group-parts') {
      const w = node.data;
      if (!w.parts) store.computeSize(w);
      return (w.parts || []).filter((p) => p.bytes > 0).map((p) => new Node('part', p));
    }
    if (node.kind === 'group-sessions') {
      return store.loadSessions(node.data).map((s) => new Node('session', s));
    }
    return [];
  }

  _indexRows(w) {
    const v = store.visibility(w);
    if (!v.known) return [new Node('stat', { icon: 'warning', label: t('Cannot read the index'), desc: v.error })];
    const rows = [
      { icon: 'list-ordered', label: t('Index entries'), desc: v.external ? t('{0} local + {1} external', v.localIndexed, v.external) : String(v.indexed) },
      { icon: 'files', label: t('JSONL files'), desc: String(v.jsonl) },
      { icon: 'eye', label: t('Visible (intersection)'), desc: String(v.visible) }
    ];
    if (v.external) rows.push({ icon: 'globe', label: t('External sessions (Copilot CLI / Claude, etc.)'), desc: t('{0} — stored in agentSessionData, not ghosts', v.external) });
    if (v.orphan) rows.push({ icon: 'question', label: t('Orphaned (file present, not indexed)'), desc: t('{0} — not visible in the panel', v.orphan) });
    if (v.ghost) rows.push({ icon: 'warning', label: t('Ghost (indexed, file missing)'), desc: t('{0} — not visible either; “Repair Session Index” clears them', v.ghost) });
    return rows.map((r) => new Node('stat', r));
  }

  // ---------- 各类节点 ----------

  _groupItem(node, label, icon) {
    const it = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Collapsed);
    it.iconPath = new vscode.ThemeIcon(icon);
    it.contextValue = 'wsGroup';
    return it;
  }

  _workspaceItem(w) {
    const flags = [];
    if (w.isCurrent) flags.push(t('[current]'));
    const reason = store.suggestReason(w);
    if (reason) flags.push('⚠️');

    const it = new vscode.TreeItem(
      `${flags.join(' ')} ${w.label}`.trim(),
      vscode.TreeItemCollapsibleState.Collapsed
    );
    it.id = w.hash;
    // ⚠️ 当前工作区用**不同**的 contextValue：
    //    menu 的 when 不能引用“按项”的变量，但能判断 contextValue
    //    → 这样“删除”菜单项对当前工作区**直接不出现**（而非只在代码里拦）
    it.contextValue = w.isCurrent ? 'wsWorkspaceCurrent' : 'wsWorkspace';
    it.iconPath = new vscode.ThemeIcon(
      w.isCurrent ? 'folder-active'
        : (w.remote ? 'remote' : (w.folderExists ? 'folder' : 'folder-library'))
    );
    it.description = [
      t('{0} sessions', w.sessionFiles.length),
      w.size === null ? t('(measuring…)') : fmtSize(w.size),
      fmtDate(w.mtime)
    ].join(' · ');

    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${w.label}**${w.isCurrent ? '\u3000' + t('`current workspace`') : ''}${w.remote ? '\u3000' + t('`remote`') : ''}\n\n`);
    md.appendMarkdown(t('- Target: `{0}`', w.folderDisplay || w.folderPath || t('(none)')) + '\n');
    md.appendMarkdown(t('- Exists: {0}', w.remote ? t('🌐 Remote workspace (not checked locally)') : (w.folderExists ? '✅' : t('❌ **missing**'))) + '\n');
    md.appendMarkdown(t('- Size: **{0}**　Sessions: **{1}**', w.size === null ? t('calculating…') : fmtSize(w.size), w.sessionFiles.length) + '\n');
    md.appendMarkdown(t('- Storage hash: `{0}`　Last used: {1}', w.hash, fmtDate(w.mtime)) + '\n');
    if (w.size && w.parts) {
      md.appendMarkdown('\n' + t('Size breakdown:') + '\n\n');
      for (const p of w.parts.slice(0, 6)) {
        if (p.bytes <= 0) continue;
        md.appendMarkdown(`- ${p.name} · ${fmtSize(p.bytes)}\n`);
      }
    }
    if (reason) md.appendMarkdown('\n---\n\n' + t('$(warning) **Consider deleting**: {0}', reason) + '\n');
    md.supportThemeIcons = true;
    it.tooltip = md;
    return it;
  }

  _partItem(p) {
    const c = store.classifyPart(p.name);
    const icon = c.kind === 'data' ? 'lock' : c.kind === 'cache' ? 'archive' : 'question';
    const tag = c.kind === 'data' ? t('data') : c.kind === 'cache' ? t('cleanable') : t('unknown');
    const it = new vscode.TreeItem(p.name, vscode.TreeItemCollapsibleState.None);
    it.iconPath = new vscode.ThemeIcon(icon);
    it.description = `${fmtSize(p.bytes)}　${tag}`;
    it.contextValue = 'wsPart';
    it.tooltip = `${p.name}　·　${fmtSize(p.bytes)}\n\n${tag}: ${c.note}`;
    return it;
  }

  _sessionItem(s) {
    const label = s.title || t('(untitled) {0}', s.id.slice(0, 8));
    const it = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    it.id = s.file;
    const bytes = (() => { try { return require('fs').statSync(s.file).size; } catch { return 0; } })();
    const orphan = s.orphan === true;

    // 大体积预警：巨型会话多半是工具输出 / 附件 base64 被内联进来了
    let bigLimit = 50;
    try { bigLimit = vscode.workspace.getConfiguration('wsManager').get('bigSessionMB', 50); } catch { /* ignore */ }
    const big = bytes >= bigLimit * 1048576;

    it.description = `${orphan ? t('orphaned · ') : ''}${big ? '⚠️ ' : ''}${fmtDate(s.created)} · ${fmtSize(bytes)}`;
    it.iconPath = new vscode.ThemeIcon(orphan ? 'comment-unresolved' : big ? 'warning' : 'comment');
    it.contextValue = 'wsSession';
    // 点击不绑命令：信息全部放悬停提示（之前那种弹窗给的内容比 tooltip 还少，纯属多余）
    const tip = [
      label,
      '',
      t('Created: {0}', s.created ? new Date(s.created).toLocaleString() : t('not recorded')),
      t('Size: {0}', fmtSize(bytes)),
      orphan ? t('⚠️ Orphaned: not in the index, invisible in the panel') : t('✅ Visible in the panel')
    ];
    if (big) {
      tip.push('', t('📦 {0} MB or larger — tool output or base64 attachments were probably written into this session.', bigLimit),
        t('  Tune the threshold with wsManager.bigSessionMB.'));
    }
    if (s.fileTitle && s.fileTitle !== s.title) tip.push('', t('First message in the file: {0}', s.fileTitle));
    tip.push('', t('id: {0}', s.id), t('File: {0}', s.file));
    it.tooltip = tip.join('\n');
    return it;
  }
}

module.exports = { WorkspaceTreeProvider, Node };
