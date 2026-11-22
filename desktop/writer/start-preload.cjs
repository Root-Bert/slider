// The start page's bridge (start.html). The server's pages get the tab bar's buttons for the
// document in front (`writerDesktop`); the main process answers only the server it is signed
// in to.
/* global location */
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('writer', {
    signIn: (server) => ipcRenderer.invoke('writer:sign-in', server),
    ready: () => ipcRenderer.invoke('writer:ready'),
    onState: (listener) => ipcRenderer.on('writer:start', (_event, state) => listener(state)),
  });
} else {
  contextBridge.exposeInMainWorld('writerDesktop', {
    /**
     * What the document offers in the tab bar, top right: `{ export, exportOpen }`, or `null` –
     * no document in front, nothing to offer. What is clicked there, or picked in the menu bar,
     * comes back as the page's `writer:desktop` event (`'new' | 'open' | 'export' | 'print' |
     * 'close'`).
     */
    docBar: (offer) => ipcRenderer.send('tabs:docBar', offer),
  });
}
