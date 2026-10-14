'use strict';
/**
 * 通用小工具：体积格式化、目录遍历、时间格式化。
 */
const fs = require('fs');
const path = require('path');

function fmtSize(bytes) {
  if (!bytes) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${u[i]}`;
}

function fmtDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const now = Date.now();
  const days = (now - ms) / 86400000;
  if (days < 1) return '今天';
  if (days < 2) return '昨天';
  if (days < 30) return `${Math.floor(days)} 天前`;
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * 递归统计目录体积与文件数。
 * 用同步 API 但只在小目录上调用；大目录由调用方按需触发并缓存。
 */
function dirStats(dir) {
  let bytes = 0;
  let files = 0;
  const walk = (d) => {
    let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.isFile()) continue;   // 跳过符号链接等
      try { bytes += fs.statSync(p).size; files++; } catch { /* 忽略 */ }
    }
  };
  walk(dir);
  return { bytes, files };
}

/** 列出目录下的条目名（失败返回空数组） */
function listNames(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
}

/** 路径是否存在 */
function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

module.exports = { fmtSize, fmtDate, dirStats, listNames, exists };
