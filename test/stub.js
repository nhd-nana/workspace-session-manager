'use strict';
/**
 * 测试用：把 `vscode` 模块换成最小桩，让 src/* 能在纯 Node 下跑。
 * 用法： require('./stub') 必须在 require('../src/store') 之前调用。
 */
const Module = require('module');
const { fileURLToPath } = require('url');

let installed = false;

function install() {
    if (installed) return;
    installed = true;
    const origLoad = Module._load;
    Module._load = function (request, ...rest) {
        if (request === 'vscode') {
            return {
                Uri: {
                    // 最小模拟 vscode.Uri.parse：支持 file 与 vscode-remote 等自定义协议
                    parse: (s) => {
                        const m = /^([A-Za-z][A-Za-z0-9+.\-]*):\/\/([^/?#]*)([^?#]*)/.exec(s);
                        if (!m) throw new Error('bad uri: ' + s);
                        const scheme = m[1].toLowerCase();
                        const authority = decodeURIComponent(m[2] || '');
                        const pathPart = decodeURIComponent(m[3] || '');
                        return {
                            scheme,
                            authority,
                            path: pathPart,
                            // 真实 API 对非 file 协议不可用 fsPath
                            fsPath: scheme === 'file' ? fileURLToPath(s) : null
                        };
                    },
                    file: (p) => ({ scheme: 'file', authority: '', path: p, fsPath: p })
                }
            };
        }
        return origLoad.call(this, request, ...rest);
    };
}

module.exports = { install };
