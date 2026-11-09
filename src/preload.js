const { contextBridge, ipcRenderer } = require('electron');
const OK = /^(state|session|pty|browser|business|ui|mcp|audit|settings)[:.]/;
contextBridge.exposeInMainWorld('hub', {
  invoke: (ch, ...a) => { if (!OK.test(ch)) throw new Error('不許可のチャンネル：' + ch); return ipcRenderer.invoke(ch, ...a); },
  on: (ch, fn) => {
    if (!OK.test(ch)) throw new Error('不許可のチャンネル：' + ch);
    const h = (_e, ...a) => fn(...a);
    ipcRenderer.on(ch, h);
    return () => ipcRenderer.removeListener(ch, h);
  },
});
