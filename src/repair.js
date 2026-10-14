'use strict';
/**
 * repair.js —— 修复「索引 ∩ 文件」失配：把孤儿会话补进索引、清掉无用的幽灵条目。
 *
 * 背景（详见 repo 记忆 vscode-session-storage.md）：
 *   · 面板显示 = 索引条目 ∩ chatSessions/{id}.jsonl 存在
 *   · 孤儿 = 文件在、索引无 → 面板看不到（历史遗留：搬文件时索引没跟着搬）
 *   · 幽灵 = 索引在、文件无 → 面板出现空白项
 *
 * 安全红线（务必遵守）：
 *   🚫 绝不写「当前工作区」的库 —— VS Code 内存里的 indexCache 会在下次 storeSessions 时整体覆盖
 *   💾 写前必须备份 state.vscdb
 *   🔒 外部会话（id 含 : 或 /，如 agent-host-copilotcli:/…）永不清理 —— 它们的实体在 agentSessionData/，不是垃圾
 *   🔒 本模块只增删「索引条目」，**从不删会话文件**
 */
const fs = require('fs');
const path = require('path');
const sqlite = require('./sqlite');
const store = require('./store');

/** 默认：小于此字节数的孤儿视为空壳，不补进索引（避免面板多出一堆空白项） */
const DEFAULT_MIN_BYTES = 2048;

/**
 * 外部会话判定：id 含 `:` 或 `/` 的都不可能是本地文件名。
 * 例：agent-host-copilotcli:/<uuid>、remote-ssh-remote+host-/path
 */
function isExternalId(id) {
  return /[:/]/.test(id);
}

/**
 * 实时列举某工作区的会话文件。
 * ⚠️ 不要用 entry.sessionFiles —— 那是 provider.refresh()/scan() 时的**快照**，
 *    清理空会话或新建会话之后它就过期了（会让 ghost/orphan 双双算成 0，看起来「什么都没做」）。
 */
function listSessionFiles(dir) {
  const csDir = path.join(dir, 'chatSessions');
  try {
    return fs.readdirSync(csDir)
      .filter((n) => n.endsWith('.jsonl'))
      .map((n) => path.join(csDir, n));
  } catch { return []; }
}

/**
 * 把「索引条目」与「chatSessions 文件」对齐成四类。只读。
 * @returns {{ok:boolean, error?:string, entry, index, entries, files, visible, orphan, ghost, external}}
 */
async function analyze(entry) {
  await store.ensureIndex(entry);
  const idx = entry._index;
  if (!idx) return { ok: false, error: '索引未读取' };
  if (idx.error) return { ok: false, error: idx.error };
  if (!idx.raw) return { ok: false, error: '索引不可用' };

  const entries = idx.raw.entries || {};
  const keys = Object.keys(entries);
  const localKeys = new Set(keys.filter((k) => !isExternalId(k)));
  const external = keys.filter(isExternalId);

  const files = entry.sessionFiles.map((f) => {
    let st = null;
    try { st = fs.statSync(f); } catch { /* ignore */ }
    return {
      id: path.basename(f, '.jsonl'),
      file: f,
      size: st ? st.size : 0,
      // ⚠️ 必须取整：statSync().mtimeMs 是浮点，而 VS Code 的 lastMessageDate 是整数毫秒
      mtime: st ? Math.round(st.mtimeMs) : 0
    };
  });
  const fileIds = new Set(files.map((f) => f.id));

  return {
    ok: true,
    entry,
    index: idx.raw,
    entries,
    files,
    visible: files.filter((f) => localKeys.has(f.id)),
    orphan: files.filter((f) => !localKeys.has(f.id)),
    ghost: [...localKeys].filter((id) => !fileIds.has(id)),
    external
  };
}

/**
 * 判定「空会话」——权威判据是**内容**：整个 JSONL 里从未往 `requests` 里写入过东西。
 *
 * ⚠️ 踩过的坑（2026-10-14）：**只看 kind0 快照会全错**。
 *    会话是「空着创建」的 —— kind0 里 **永远** 是 `"requests":[]`，内容靠后续 kind1 delta 追加。
 *    所以必须同时找 `"k":["requests",…]` 形式的 delta。
 * ⚠️ 大文件（300 MB+）不能全读 → 流式扫描，**一找到证据立刻返回**。
 * ⚠️ 扫到 SCAN_LIMIT 仍未找到证据 → **保守判为「有内容」**（宁可留着，绝不误删）。
 *
 * @returns {boolean|null} null = 读取失败，无法判定
 */
const SCAN_LIMIT = 4 * 1024 * 1024;

function isEmptySession(file) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  if (st.size === 0) return true;

  const CHUNK = 128 * 1024;
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return null; }
  try {
    const end = Math.min(st.size, SCAN_LIMIT);
    let carry = '';
    let pos = 0;
    while (pos < end) {
      const len = Math.min(CHUNK, end - pos);
      const buf = Buffer.alloc(len);
      const n = fs.readSync(fd, buf, 0, len, pos);
      if (n <= 0) break;
      const text = carry + buf.toString('utf8', 0, n);
      pos += n;

      // delta 往 requests 的**某个具体下标**写内容才算数。
      // ⚠️ 不能只匹配 `"k":["requests"`——「整体替换为空数组」的 delta（{"k":["requests"],"v":[]}）
      //    也会命中，从而把空会话误判成有内容
      if (/"k"\s*:\s*\[\s*"requests"\s*,\s*\d+/.test(text)) return false;
      // delta 把 requests 整体设成非空数组
      if (/"k"\s*:\s*\[\s*"requests"\s*\]\s*,\s*"v"\s*:\s*\[\s*\{/.test(text)) return false;
      // kind0 里 requests 本身就非空
      if (/"requests"\s*:\s*\[\s*\{/.test(text)) return false;

      carry = text.slice(-64);   // 跨块边界
    }
    // 没扫完（文件比 SCAN_LIMIT 大）→ 保守认为有内容
    return st.size <= end;
  } finally {
    fs.closeSync(fd);
  }
}

/** 由 JSONL 造一条索引条目（字段结构照 2026-10-14 实测的真实条目；本地条目不带 inputState） */
function buildEntry(f) {
  const meta = store.readSessionMeta(f.file);
  const created = meta.created && meta.created > 0 ? meta.created : f.mtime;
  return {
    sessionId: f.id,
    title: meta.title || '(无标题)',
    lastMessageDate: f.mtime,
    timing: {
      created,
      lastRequestStarted: f.mtime,
      lastRequestEnded: f.mtime
    },
    initialLocation: 'panel',
    hasPendingEdits: false,
    // ⚠️ **必须按内容算** —— VS Code 自己的定义就是 `requests.length === 0`。
    //    写死 false 会让空会话在面板里冒出来，还会被依标记判定的清理逻辑漏掉
    isEmpty: isEmptySession(f.file) === true,
    permissionLevel: 'default'
  };
}

/**
 * 生成修复计划（**纯计算，不写盘**）。
 * @param {object} opts { minBytes?: number, restore?: boolean, cleanGhost?: boolean }
 */
async function plan(entry, opts = {}) {
  const a = await analyze(entry);
  if (!a.ok) return a;

  const minBytes = opts.minBytes != null ? opts.minBytes : DEFAULT_MIN_BYTES;
  const restore = opts.restore !== false;
  const cleanGhost = opts.cleanGhost !== false;

  const candidates = restore ? a.orphan : [];
  const toAdd = candidates.filter((f) => f.size >= minBytes);
  const skipped = candidates.filter((f) => f.size < minBytes);
  const toRemove = cleanGhost ? a.ghost.slice() : [];

  // 空会话统计（只报告，不在这里删）：分离「名存实亡」的空壳
  const emptyOrphans = skipped.filter((f) => isEmptySession(f.file) === true);
  // ⚠️ 不能依赖索引里的 isEmpty 标记 —— VS Code 会标错
  //    （实测：~1.9 KB、requests 为空的会话被判成 isEmpty:false，导致清理漏掉它们）
  //    一律以**文件内容**为准
  const emptyVisible = a.visible.filter((f) => isEmptySession(f.file) === true);

  return {
    ok: true,
    ...a,
    minBytes,
    toAdd,
    skipped,
    toRemove,
    emptyOrphans,
    emptyVisible,
    bytesAdded: toAdd.reduce((s, f) => s + f.size, 0),
    bytesSkipped: skipped.reduce((s, f) => s + f.size, 0)
  };
}

/**
 * 备份文件名固定为 `state.vscdb.wsmgr-bak` —— **只保留一份，每次覆盖**。
 * （state.vscdb 动辄几 MB，多存几份比会话数据本身还占地方）
 */
const BAK_SUFFIX = '.wsmgr-bak';

/** 备份 state.vscdb（覆盖旧备份）；成功返回备份路径，失败返回 null（调用方须中止） */
function backupDb(dbPath) {
  try {
    const bak = dbPath + BAK_SUFFIX;
    fs.copyFileSync(dbPath, bak);
    return bak;
  } catch { return null; }
}

/** 取备份信息；没有则返回 null */
function getBackup(dir) {
  const p = path.join(dir, 'state.vscdb' + BAK_SUFFIX);
  if (!fs.existsSync(p)) return null;
  let st = null;
  try { st = fs.statSync(p); } catch { return null; }
  return { path: p, name: path.basename(p), size: st.size, when: Math.round(st.mtimeMs) };
}

/**
 * 把备份还原回 state.vscdb。
 * 语义是**交换**：当前状态会被写进备份文件，所以再点一次「还原索引备份」就能换回去。
 */
function restoreBackup(dir) {
  const dbPath = path.join(dir, 'state.vscdb');
  const bakPath = dbPath + BAK_SUFFIX;
  if (!fs.existsSync(bakPath)) return { ok: false, error: '没有备份可还原' };
  if (!fs.existsSync(dbPath)) return { ok: false, error: 'state.vscdb 不存在' };
  try {
    const old = fs.readFileSync(bakPath);   // 先把旧备份读进内存
    fs.copyFileSync(dbPath, bakPath);       // 当前 → 备份（覆盖）
    fs.writeFileSync(dbPath, old);          // 旧 → state.vscdb
  } catch (e) {
    return { ok: false, error: `还原失败：${e.message}` };
  }
  return { ok: true, swapped: true };
}

/**
 * 执行修复：备份 → 合并索引 → 写回。
 * @param {object} p plan() 的结果
 * @param {object} opts { backup?: boolean, currentDbPath?: string, allowCurrent?: boolean }
 */
async function apply(entry, p, opts = {}) {
  if (!p || !p.ok) return { ok: false, error: '计划无效' };
  // allowCurrent: 对「当前工作区的窗口」也写盘 —— 只有在调用方能担保
  // 用户会**立即重载窗口**（重建 ChatSessionStore、丢弃内存 indexCache）时才可传 true
  if (entry.isCurrent && !opts.allowCurrent) {
    return {
      ok: false,
      error: '拒绝写入当前工作区：VS Code 内存里的 indexCache 会在下次会话变更时整体覆盖盘上的索引。'
        + '若确认能立即重载窗口，可传 allowCurrent。'
    };
  }
  const dbPath = path.join(entry.dir, 'state.vscdb');
  if (!fs.existsSync(dbPath)) return { ok: false, error: 'state.vscdb 不存在' };

  const next = JSON.parse(JSON.stringify(p.index));
  if (!next.entries) next.entries = {};

  let added = 0;
  for (const f of p.toAdd) {
    if (!next.entries[f.id]) {
      next.entries[f.id] = buildEntry(f);
      added++;
    }
  }
  let removed = 0;
  for (const id of p.toRemove) {
    if (next.entries[id]) { delete next.entries[id]; removed++; }
  }

  // 备份（失败则中止，绝不无备份写盘）
  let backup = null;
  if (opts.backup !== false) {
    backup = backupDb(dbPath);
    if (backup === null) return { ok: false, error: '备份失败，已中止' };
  }

  const r = await sqlite.writeIndex(dbPath, next, opts.currentDbPath || null);
  if (!r.ok) return { ok: false, error: r.error, backup };

  // 让下次刷新重读
  entry._index = undefined;
  entry._sessions = undefined;

  return { ok: true, added, removed, backup, total: Object.keys(next.entries).length };
}

module.exports = {
  isExternalId, isEmptySession, listSessionFiles,
  analyze, plan, apply, buildEntry, DEFAULT_MIN_BYTES,
  backupDb, getBackup, restoreBackup
};
