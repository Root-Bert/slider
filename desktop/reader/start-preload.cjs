// The start page's bridge (start.html). The server's pages get the tab bar's buttons for the
// PDF in front (`readerDesktop`, as Writer's `writerDesktop`); the main process answers only the
// server it is signed in to.
/* global location */
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('reader', {
    signIn: (server) => ipcRenderer.invoke('reader:sign-in', server),
    ready: () => ipcRenderer.invoke('reader:ready'),
    onState: (listener) => ipcRenderer.on('reader:start', (_event, state) => listener(state)),
  });
} else {
  contextBridge.exposeInMainWorld('readerDesktop', {
    /**
     * What the PDF offers in the tab bar, top right: `{ export, exportOpen }`, or `null` – no
     * PDF in front, nothing to offer. What is clicked there, or picked in the menu bar, comes
     * back as the page's `reader:desktop` event (`'open' | 'export' | 'print' | 'close'`).
     */
    docBar: (offer) => ipcRenderer.send('tabs:docBar', offer),
  });
}
