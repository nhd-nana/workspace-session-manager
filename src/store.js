'use strict';
/**
 * store.js —— 扫描 VS Code 的 workspaceStorage，产出可展示的工作区模型。
 *
 * 存储结构（实测）：
 *   %APPDATA%/Code/User/workspaceStorage/{hash}/
 *     ├── workspace.json           → {"folder":"file:///d%3A/Code"} 或 {"workspace":"file:///...code-workspace"}
 *     ├── chatSessions/{id}.jsonl  → 会话完整数据（delta 格式）
 *     ├── chatEditingSessions/
 *     ├── GitHub.copilot-chat/     → debug-logs / transcripts / chat-session-resources
 *     └── state.vscdb (+ 备份)
 *
 * 本模块**只读文件系统**，不碰 SQLite（索引读写留到「会话移动/复制」阶段）。
 */
const fs = require('fs');
const path = require('path');
const { dirStats, exists } = require('./util');
const sqlite = require('./sqlite');
// ⚠️ 不在此处 require('vscode')：让本模块能在纯 Node（脱离扩展宿主）下被 repair.js / 独立脚本复用。
//    只有 decodeTarget() 用到 vscode.Uri，改为惰性 require。

/** 用户目录：<User>（globalStorageUri = <User>/globalStorage/<extId>） */
function getUserDir(context) {
  return path.dirname(path.dirname(context.globalStorageUri.fsPath));
}

function getStorageRoot(context) {
  return path.join(getUserDir(context), 'workspaceStorage');
}

/** 当前窗口自己的 workspaceStorage hash */
function getCurrentHash(context) {
  if (!context.storageUri) return null;
  // <User>/workspaceStorage/<hash>/<extId>
  return path.basename(path.dirname(context.storageUri.fsPath));
}

/** 把 file:///d%3A/Code 或 vscode-remote://ssh-remote+x/home/y 解成展示/校验所需信息 */
function decodeTarget(raw) {
  if (!raw) return null;
  const vscode = require('vscode');   // 惰性：仅此处需要
  let uri;
  try { uri = vscode.Uri.parse(raw); } catch { return null; }
  const scheme = uri.scheme || 'file';
  const isFile = scheme === 'file';

  // ⚠️ 非 file scheme 时不可调 fsPath（会抛），也不可用本地 fs 判存在性
  let fsPath = null;
  if (isFile) { try { fsPath = uri.fsPath; } catch { fsPath = null; } }

  if (!isFile) {
    const auth = uri.authority ? uri.authority + ':' : '';
    const p = uri.path || '';
    return {
      scheme, remote: true, fsPath: null,
      folderDisplay: `${scheme}://${uri.authority || ''}${p}`,
      kind: p.toLowerCase().endsWith('.code-workspace') ? 'workspace' : 'folder',
      label: `${auth}${p}` || raw
    };
  }
  const isWorkspaceFile = (fsPath || '').toLowerCase().endsWith('.code-workspace');
  const label = path.basename(fsPath || '') || fsPath || raw;
  return {
    scheme, remote: false, fsPath,
    folderDisplay: fsPath,
    kind: isWorkspaceFile ? 'workspace' : 'folder',
    label
  };
}

/** 读 workspace.json；返回 null 表示孤儿条目 */
function readWorkspaceJson(dir) {
  const f = path.join(dir, 'workspace.json');
  if (!exists(f)) return null;
  try {
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    return j && (j.folder || j.workspace) ? j : null;
  } catch { return null; }
}

function readSessionMeta(file) {
  const id = path.basename(file, '.jsonl');
  let title = null;
  let created = null;
  try {
    const st = fs.statSync(file);
    const fd = fs.openSync(file, 'r');
    try {
      // 头部：拿 creationDate（首行是全量快照）
      const headLen = Math.min(262144, st.size);
      const head = Buffer.alloc(headLen);
      fs.readSync(fd, head, 0, headLen, 0);
      const headText = head.toString('utf8');
      const cd = /"creationDate"\s*:\s*("?[^",}]+"?)/.exec(headText);
      if (cd) {
        const v = cd[1].replace(/^"|"$/g, '');
        created = /^\d+$/.test(v) ? Number(v) : (Date.parse(v) || null);
      }
      title = extractTitle(headText) || extractFirstMessage(headText);
      // 尾部：标题常由后续 delta 补写，取最后一次
      if (st.size > headLen) {
        const tailLen = Math.min(65536, st.size - headLen);
        const tail = Buffer.alloc(tailLen);
        fs.readSync(fd, tail, 0, tailLen, st.size - tailLen);
        const t = extractTitle(tail.toString('utf8'));
        if (t) title = t;
      }
    } finally { fs.closeSync(fd); }
  } catch { /* 文件坏了也照常列出 */ }
  return { id, file, title, created };
}

/** 取文本中最后一次出现的 customTitle（字符串可能含转义） */
function extractTitle(text) {
  const re = /"customTitle"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m, last = null;
  while ((m = re.exec(text)) !== null) last = m[1];
  if (last == null) return null;
  try { return JSON.parse('"' + last + '"'); } catch { return last; }
}

/** 没 customTitle 时，回退到首条用户消息（与 VS Code 面板的展示逻辑一致） */
function extractFirstMessage(text) {
  const m = /"message"\s*:\s*\{\s*"text"\s*:\s*"((?:[^"\\]|\\.)*)"/.exec(text);
  if (!m) return null;
  let t;
  try { t = JSON.parse('"' + m[1] + '"'); } catch { return null; }
  t = String(t).replace(/\s+/g, ' ').trim();
  if (!t) return null;
  return t.length > 70 ? t.slice(0, 70) + '…' : t;
}

/** 一次扫描：只做轻量 IO（readdir + 读 workspace.json + 数会话文件） */
function scan(context) {
  const root = getStorageRoot(context);
  const curHash = getCurrentHash(context);
  const out = [];
  let names = [];
  try {
    names = fs.readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
      .map((e) => e.name);
  } catch { return { root, current: null, items: [] }; }

  for (const hash of names) {
    const dir = path.join(root, hash);
    const wj = readWorkspaceJson(dir);
    const target = wj ? decodeTarget(wj.folder || wj.workspace) : null;

    let sessionFiles = [];
    const sessDir = path.join(dir, 'chatSessions');
    try {
      sessionFiles = fs.readdirSync(sessDir)
        .filter((n) => n.endsWith('.jsonl'))
        .map((n) => path.join(sessDir, n));
    } catch { /* 没有会话目录 */ }

    let mtime = 0;
    try { mtime = fs.statSync(dir).mtimeMs; } catch { /* ignore */ }

    out.push({
      hash,
      dir,
      isCurrent: curHash === hash,
      orphan: !wj,
      target,
      label: target ? target.label : `(无 workspace.json)`,
      remote: target ? !!target.remote : false,
      folderPath: target ? target.fsPath : null,
      folderDisplay: target ? (target.folderDisplay || target.label) : '(无 workspace.json)',
      // true / false / null(null = 远程工作区，本地无法校验)
      folderExists: target ? (target.remote ? null : exists(target.fsPath)) : false,
      sessionFiles,
      mtime,
      size: null,      // 惰性计算
      parts: null      // 惰性计算
    });
  }

  // 排序：当前工作区最前，其余按目录修改时间倒序
  out.sort((a, b) => {
    if (a.isCurrent !== b.isCurrent) return a.isCurrent ? -1 : 1;
    return b.mtime - a.mtime;
  });

  return { root, current: curHash, items: out };
}

/**
 * 工作区存储里各子项的「类别」—— 决定**能不能清**。
 *
 * 原则：**白名单标数据，其余按扩展缓存处理，认不出的标 unknown（不建议清）**。
 * 宁可少清，不误删。
 */
const PART_KINDS = {
  'chatSessions': ['data', '会话数据 —— 删了就没了'],
  'chatEditingSessions': ['data', 'AI 编辑历史 —— 删了就没了'],
  'GitHub.copilot-chat': ['data', '调试日志 / 对话转录 / 会话附件'],
  'workspace.json': ['data', '工作区标识 —— 不要删'],
  'state.vscdb': ['data', '会话索引 + UI 状态 —— 不要删'],
  'state.vscdb.backup': ['cache', 'VS Code 自己的索引备份 —— 可重建，但删了就少一层保护'],
  'state.vscdb-wal': ['data', 'SQLite WAL 日志'],
  'state.vscdb-shm': ['data', 'SQLite 共享内存']
};

/** 判一个子项属于哪类：data（数据）/ cache（可重建）/ unknown（不确定） */
function classifyPart(name) {
  const hit = PART_KINDS[name];
  if (hit) return { kind: hit[0], note: hit[1] };
  if (/^state\.vscdb\.wsmgr-bak/.test(name)) {
    return { kind: 'cache', note: '本扩展的索引备份（单份，可用「还原索引备份」回退）' };
  }
  // `<publisher>.<name>` 形式 = 某个扩展的 per-workspace 存储，基本都是缓存
  if (/^[a-z0-9][a-z0-9-]*\.[a-z0-9][a-z0-9-]*$/i.test(name)) {
    return { kind: 'cache', note: '扩展的工作区缓存 —— 删后首次打开会重建（可能慢一次）' };
  }
  return { kind: 'unknown', note: '用途不明 —— 不建议清理' };
}

/** 该子项是否可以放心清理（只认明确的 cache） */
function isCleanable(name) {
  const { kind } = classifyPart(name);
  if (kind !== 'cache') return false;
  // 备份类保留（它是回退用的），只清扩展缓存与旧格式备份
  if (name === 'state.vscdb.backup') return false;
  if (name === 'state.vscdb.wsmgr-bak') return false;      // 当前的那一份
  if (/^state\.vscdb\.wsmgr-bak-/.test(name)) return true; // 旧格式（带时间戳）的可清
  return true;
}

/** 惰性：算一个工作区的体积与子目录拆解 */
function computeSize(entry) {
  if (entry.size !== null) return entry;
  const parts = [];
  let ents = [];
  try { ents = fs.readdirSync(entry.dir, { withFileTypes: true }); } catch { /* ignore */ }
  for (const e of ents) {
    const p = path.join(entry.dir, e.name);
    if (e.isDirectory()) {
      const { bytes } = dirStats(p);
      parts.push({ name: e.name, bytes, kind: 'dir' });
    } else if (e.isFile()) {
      let bytes = 0;
      try { bytes = fs.statSync(p).size; } catch { /* ignore */ }
      parts.push({ name: e.name, bytes, kind: 'file' });
    }
  }
  parts.sort((a, b) => b.bytes - a.bytes);
  entry.parts = parts;
  entry.size = parts.reduce((s, p) => s + p.bytes, 0);
  return entry;
}

/** 惰性：读某个工作区所有会话的元信息（需先 await ensureIndex） */
function loadSessions(entry) {
  if (entry._sessions) return entry._sessions;
  const idx = entry._index;
  const idxIds = idx && idx.ids ? idx.ids : null;
  const idxEntries = idx && idx.raw ? idx.raw.entries : null;
  const list = entry.sessionFiles.map((f) => {
    const m = readSessionMeta(f);
    // null = 索引未知（读失败或缺 sqlite3）；true = JSONL 在但索引没有 → 面板里看不到
    m.orphan = idxIds ? !idxIds.has(m.id) : null;
    // ★ 索引里的 title 是 Copilot 生成的「概括标题」，面板显示的就是它；
    //   文件里只有 customTitle / 首条消息 → 两者常不一致，故索引优先，文件标题留作对照
    const e = idxEntries && idxEntries[m.id];
    if (e && e.title) {
      m.fileTitle = m.title;
      m.title = e.title;
    }
    return m;
  });
  list.sort((a, b) => (b.created || 0) - (a.created || 0));
  entry._sessions = list;
  return list;
}

/** 惰性：读会话索引（异步，缓存）。读当前工作区也是安全的（不写）。 */
async function ensureIndex(entry) {
  if (entry._index !== undefined) return entry._index;
  const r = await sqlite.readIndex(path.join(entry.dir, 'state.vscdb'));
  entry._index = r.ok
    ? { ids: new Set(Object.keys(r.index.entries)), raw: r.index, error: null }
    : { ids: new Set(), raw: null, error: r.error };
  return entry._index;
}

/** 可见性统计：面板显示的是「索引 ∩ 文件存在」的交集 */
function visibility(entry) {
  const idx = entry._index;
  if (!idx) return { known: false, error: '未读取索引' };
  if (idx.error) return { known: false, error: idx.error };
  const jsonlIds = new Set(entry.sessionFiles.map((f) => path.basename(f, '.jsonl')));
  let visible = 0;
  let orphan = 0;
  let ghost = 0;
  let external = 0;
  for (const id of jsonlIds) { if (idx.ids.has(id)) visible++; else orphan++; }
  for (const id of idx.ids) {
    if (jsonlIds.has(id)) continue;
    // ⚠️ 外部会话（agent-host-copilotcli:/… / agent-host-claude:/… / remote-…）在 chatSessions 里
    //    当然没有文件，但它们的实体在 %APPDATA%\Code\agentSessionData\ —— **不是幽灵**，不能算进来
    if (/[:/]/.test(id)) external++;
    else ghost++;
  }
  const localIndexed = idx.ids.size - external;
  return { known: true, indexed: idx.ids.size, localIndexed, external, jsonl: jsonlIds.size, visible, orphan, ghost };
}

/** 这条工作区该不该建议删除（仅推荐，不执行） */
function suggestReason(entry) {
  if (entry.isCurrent) return null;
  if (entry.orphan) return '没有 workspace.json —— 条目已孤立，建议删除';
  // 远程工作区（ssh-remote / wsl / dev-container）无法本地校验，不轻易下结论
  if (entry.remote) return null;
  if (entry.folderExists === false) return `对应目录已不存在：${entry.folderPath} —— 建议删除`;
  return null;
}

module.exports = {
  getUserDir, getStorageRoot, getCurrentHash,
  scan, computeSize, loadSessions, ensureIndex, visibility, suggestReason,
  classifyPart, isCleanable,
  readSessionMeta          // repair.js 造索引条目时要复用
};
