'use strict';
/**
 * dup.js —— 跨工作区「重复会话」检测。
 *
 * 指纹策略：**文件大小 + 前 64 KB 的 SHA-1**。
 *   · 不做全文哈希 —— 单条会话可达 343 MB，读全文的代价无法接受
 *   · 头 64 KB 足以区分不同会话（里面是 kind0 快照的元信息与首批请求）
 *   · 所以：**相同指纹 = 极可能同一份副本**；不同指纹 = 一定不同
 *
 * 典型来源：会话同步/搬运工具把 JSONL 复制到多个工作区（文件名即 sessionId，会被原样保留）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const repair = require('./repair');

const HEAD = 64 * 1024;

/** 算一个会话文件的指纹（顺带带回 size/mtime，避免重复 stat）；读取失败返回 null */
function fingerprint(file) {
  let st;
  try { st = fs.statSync(file); } catch { return null; }
  const len = Math.min(st.size, HEAD);
  const buf = Buffer.alloc(len);
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    fs.readSync(fd, buf, 0, len, 0);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
  const h = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
  return { fp: `${st.size}:${h}`, size: st.size, mtime: Math.round(st.mtimeMs) };
}

/**
 * 在所有工作区里找重复会话。
 * @param {Array} items store.scan() 的结果
 * @returns {{groups: Array, scanned: number, bytes: number}} groups 里每组 {fingerprint,size,copies:[{hash,label,id,file}]}
 */
function findDuplicates(items) {
  const map = new Map();
  let scanned = 0;
  for (const w of items) {
    for (const f of repair.listSessionFiles(w.dir)) {
      const info = fingerprint(f);
      if (!info) continue;
      scanned++;
      if (!map.has(info.fp)) map.set(info.fp, []);
      map.get(info.fp).push({
        hash: w.hash,
        label: w.label,
        isCurrent: w.isCurrent,
        id: path.basename(f, '.jsonl'),
        file: f,
        mtime: info.mtime,
        size: info.size
      });
    }
  }
  const groups = [];
  let bytes = 0;
  for (const [fp, copies] of map) {
    if (copies.length < 2) continue;
    const size = copies[0].size;
    // 同 id 同名、只是散在不同工作区 → 副本；同工作区内不同 id 但同内容 → 真"重复"
    const sameId = new Set(copies.map((c) => c.id)).size === 1;
    groups.push({ fingerprint: fp, size, sameId, copies });
    bytes += size * (copies.length - 1);   // 可回收的冗余（保留一份）
  }
  groups.sort((a, b) => b.size * (b.copies.length - 1) - a.size * (a.copies.length - 1));
  return { groups, scanned, bytes };
}

module.exports = { fingerprint, findDuplicates, HEAD };
