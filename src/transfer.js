'use strict';
/**
 * transfer.js —— 跨工作区「复制 / 移动会话」的**索引部分**。
 *
 * 分工（重要）：
 *   · 本模块只碰 **索引**（state.vscdb）与**计划**，纯 Node，可在无 VS Code 宿主下复用
 *   · **文件搬运一律由调用方用 `vscode.workspace.fs` 完成** —— 删除才能进回收站
 *
 * 执行顺序（调用方遵守）：
 *   1. 复制文件到目标 chatSessions/        （失败则目标索引不动，无副作用）
 *   2. registerInTarget()                  ← 目标索引登记
 *   3. 移动时：删源文件 → unregisterFromSource()
 *      ⚠️ 若第 3 步失败，最坏结果是「复制成功但源还在」= 相当于复制，不会丢数据
 */
const fs = require('fs');
const path = require('path');
const sqlite = require('./sqlite');
const repair = require('./repair');

/** 写盘前备份 state.vscdb；返回备份路径，失败返回 null（调用方须中止） */
function backup(dbPath) {
  return repair.backupDb(dbPath);
}

/**
 * 生成搬运计划。**只读**。
 * @param {string[]} ids 要搬运的 sessionId
 * @param {object} source 源工作区 entry
 * @param {object} target 目标工作区 entry
 */
async function plan(ids, source, target) {
  const tgtDir = path.join(target.dir, 'chatSessions');
  if (!fs.existsSync(tgtDir)) {
    return { ok: false, error: `目标工作区没有 chatSessions 目录：${tgtDir}` };
  }
  const tgtIds = new Set(repair.listSessionFiles(target.dir).map((f) => path.basename(f, '.jsonl')));

  const toCopy = [];
  const conflicts = [];
  const missing = [];
  for (const id of ids) {
    const src = path.join(source.dir, 'chatSessions', id + '.jsonl');
    if (!fs.existsSync(src)) { missing.push(id); continue; }
    if (tgtIds.has(id)) { conflicts.push({ id, reason: '目标已有同 ID 会话' }); continue; }
    let size = 0;
    try { size = fs.statSync(src).size; } catch { /* ignore */ }
    toCopy.push({ id, src, dest: path.join(tgtDir, id + '.jsonl'), size });
  }
  return {
    ok: true,
    toCopy,
    conflicts,
    missing,
    bytes: toCopy.reduce((s, x) => s + x.size, 0)
  };
}

/**
 * 把已复制到目标的会话登记进**目标**索引。
 * 调用前必须确保 `items[].dest` 文件已经存在（buildEntry 要从文件里读标题/创建时间）。
 * @param {Array<{id:string,dest:string}>} items
 */
async function registerInTarget(target, items, currentDbPath) {
  const dbPath = path.join(target.dir, 'state.vscdb');
  if (!fs.existsSync(dbPath)) return { ok: false, error: '目标工作区没有 state.vscdb' };

  const r = await sqlite.readIndex(dbPath);
  if (!r.ok) return { ok: false, error: r.error };
  const next = JSON.parse(JSON.stringify(r.index));
  if (!next.entries) next.entries = {};

  let added = 0;
  for (const it of items) {
    if (next.entries[it.id]) continue;
    let st = null;
    try { st = fs.statSync(it.dest); } catch { /* ignore */ }
    next.entries[it.id] = repair.buildEntry({
      id: it.id,
      file: it.dest,
      size: st ? st.size : 0,
      mtime: st ? Math.round(st.mtimeMs) : Date.now()
    });
    added++;
  }

  const bak = backup(dbPath);
  if (bak === null) return { ok: false, error: '备份 state.vscdb 失败，已中止' };

  const w = await sqlite.writeIndex(dbPath, next, currentDbPath);
  if (!w.ok) return { ok: false, error: w.error, backup: bak };

  target._index = undefined;
  target._sessions = undefined;
  return { ok: true, added, backup: bak, total: Object.keys(next.entries).length };
}

/**
 * 从**源**索引里注销这些会话（移动模式下，文件已删除之后调用）。
 * 只删本地条目；外部会话 id（含 : /）不在此列。
 */
async function unregisterFromSource(source, ids, currentDbPath) {
  const dbPath = path.join(source.dir, 'state.vscdb');
  if (!fs.existsSync(dbPath)) return { ok: false, error: '源工作区没有 state.vscdb' };

  const r = await sqlite.readIndex(dbPath);
  if (!r.ok) return { ok: false, error: r.error };
  const next = JSON.parse(JSON.stringify(r.index));
  if (!next.entries) next.entries = {};

  let removed = 0;
  for (const id of ids) {
    if (next.entries[id]) { delete next.entries[id]; removed++; }
  }

  const bak = backup(dbPath);
  if (bak === null) return { ok: false, error: '备份 state.vscdb 失败，已中止' };

  const w = await sqlite.writeIndex(dbPath, next, currentDbPath);
  if (!w.ok) return { ok: false, error: w.error, backup: bak };

  source._index = undefined;
  source._sessions = undefined;
  return { ok: true, removed, backup: bak, total: Object.keys(next.entries).length };
}

module.exports = { plan, registerInTarget, unregisterFromSource, backup };
