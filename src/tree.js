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
    if (node.kind === 'group-parts') return this._groupItem(node, '存储明细', 'graph');
    if (node.kind === 'group-sessions') {
      const n = node.data.sessionFiles.length;
      const v = store.visibility(node.data);
      const extra = v.known && v.orphan ? `，${v.orphan} 孤儿` : '';
      return this._groupItem(node, `会话（${n}${extra}）`, 'comment-discussion');
    }
    if (node.kind === 'group-index') return this._groupItem(node, '会话索引概览', 'list-tree');
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
    if (!v.known) return [new Node('stat', { icon: 'warning', label: '读不到索引', desc: v.error })];
    const rows = [
      { icon: 'list-ordered', label: '索引条目', desc: v.external ? `${v.localIndexed} 本地 + ${v.external} 外部` : String(v.indexed) },
      { icon: 'files', label: 'JSONL 文件', desc: String(v.jsonl) },
      { icon: 'eye', label: '可见（交集）', desc: String(v.visible) }
    ];
    if (v.external) rows.push({ icon: 'globe', label: '外部会话（Copilot CLI / Claude 等）', desc: `${v.external} —— 实体在 agentSessionData，不是幽灵` });
    if (v.orphan) rows.push({ icon: 'question', label: '孤儿（有文件、无索引）', desc: `${v.orphan} —— 面板里看不到` });
    if (v.ghost) rows.push({ icon: 'warning', label: '幽灵（有索引、无文件）', desc: `${v.ghost} —— 面板里是空白项（跑一次「修复会话索引」即可清掉）` });
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
    if (w.isCurrent) flags.push('【当前】');
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
      `${w.sessionFiles.length} 会话`,
      w.size === null ? '(算体积…)' : fmtSize(w.size),
      fmtDate(w.mtime)
    ].join(' · ');

    const md = new vscode.MarkdownString();
    md.appendMarkdown(`**${w.label}**${w.isCurrent ? '　`当前工作区`' : ''}${w.remote ? '　`远程`' : ''}\n\n`);
    md.appendMarkdown(`- 目标：\`${w.folderDisplay || w.folderPath || '（无）'}\`\n`);
    md.appendMarkdown(`- 存在性：${w.remote ? '🌐 远程工作区（本地不校验）' : (w.folderExists ? '✅' : '❌ **不存在**')}\n`);
    md.appendMarkdown(`- 体积：**${w.size === null ? '计算中…' : fmtSize(w.size)}**　会话：**${w.sessionFiles.length}**\n`);
    md.appendMarkdown(`- 存储 hash：\`${w.hash}\`　最后使用：${fmtDate(w.mtime)}\n`);
    if (w.size && w.parts) {
      md.appendMarkdown(`\n体积构成：\n\n`);
      for (const p of w.parts.slice(0, 6)) {
        if (p.bytes <= 0) continue;
        md.appendMarkdown(`- ${p.name} · ${fmtSize(p.bytes)}\n`);
      }
    }
    if (reason) md.appendMarkdown(`\n---\n\n$(warning) **建议删除**：${reason}\n`);
    md.supportThemeIcons = true;
    it.tooltip = md;
    return it;
  }

  _partItem(p) {
    const c = store.classifyPart(p.name);
    const icon = c.kind === 'data' ? 'lock' : c.kind === 'cache' ? 'archive' : 'question';
    const tag = c.kind === 'data' ? '数据' : c.kind === 'cache' ? '可清理' : '未识别';
    const it = new vscode.TreeItem(p.name, vscode.TreeItemCollapsibleState.None);
    it.iconPath = new vscode.ThemeIcon(icon);
    it.description = `${fmtSize(p.bytes)}　${tag}`;
    it.contextValue = 'wsPart';
    it.tooltip = `${p.name}　·　${fmtSize(p.bytes)}\n\n${tag}：${c.note}`;
    return it;
  }

  _sessionItem(s) {
    const label = s.title || `(无标题) ${s.id.slice(0, 8)}`;
    const it = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    it.id = s.file;
    const bytes = (() => { try { return require('fs').statSync(s.file).size; } catch { return 0; } })();
    const orphan = s.orphan === true;

    // 大体积预警：巨型会话多半是工具输出 / 附件 base64 被内联进来了
    let bigLimit = 50;
    try { bigLimit = vscode.workspace.getConfiguration('wsManager').get('bigSessionMB', 50); } catch { /* ignore */ }
    const big = bytes >= bigLimit * 1048576;

    it.description = `${orphan ? '孤儿 · ' : ''}${big ? '⚠️ ' : ''}${fmtDate(s.created)} · ${fmtSize(bytes)}`;
    it.iconPath = new vscode.ThemeIcon(orphan ? 'comment-unresolved' : big ? 'warning' : 'comment');
    it.contextValue = 'wsSession';
    // 点击不绑命令：信息全部放悬停提示（之前那种弹窗给的内容比 tooltip 还少，纯属多余）
    const tip = [
      label,
      '',
      `创建：${s.created ? new Date(s.created).toLocaleString() : '未知'}`,
      `大小：${fmtSize(bytes)}`,
      orphan ? '⚠️ 孤儿：索引里没有登记，面板里看不到它' : '✅ 面板可见'
    ];
    if (big) {
      tip.push('', `📦 体积已超过 ${bigLimit} MB —— 多半是工具输出或附件（base64）被写进了会话。`,
        '  可在设置里调 wsManager.bigSessionMB 改阈值。');
    }
    if (s.fileTitle && s.fileTitle !== s.title) tip.push('', `文件里的首条消息：${s.fileTitle}`);
    tip.push('', `id：${s.id}`, `文件：${s.file}`);
    it.tooltip = tip.join('\n');
    return it;
  }
}

module.exports = { WorkspaceTreeProvider, Node };
