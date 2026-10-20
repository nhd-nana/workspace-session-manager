'use strict';
/**
 * l10n.js —— 统一的本地化入口。
 *
 * 约定：**源码里一律写英文**。VS Code 的 l10n 机制以英文为源语言 ——
 * 英文界面下不加载 bundle，`l10n.t()` 直接返回源码字符串；中文翻译放
 * `l10n/bundle.l10n.zh-cn.json`，键 = 英文原文。
 *
 * 纯 Node（测试）环境下 vscode 桩没有 l10n，这里退回简单的 {n} 替换，
 * 于是测试看到的就是英文原文 —— 与英文界面的效果一致。
 */
let _t;
try {
    const vs = require('vscode');
    if (vs && vs.l10n && typeof vs.l10n.t === 'function') {
        _t = vs.l10n.t.bind(vs.l10n);
    }
} catch {
    /* 纯 Node 环境：没有 vscode 模块 */
}

/**
 * 取一条已本地化的文案。
 * @param {string} message 英文原文；占位符用 {0} {1}
 * @param {...any} args 依次填入占位符
 * @returns {string}
 */
function t(message, ...args) {
    if (_t) {
        return _t(message, ...args);
    }
    if (!args.length) {
        return message;
    }
    return String(message).replace(/\{(\d+)\}/g, (m, i) => (i in args ? String(args[i]) : m));
}

module.exports = { t };
