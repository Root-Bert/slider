// The start page's bridge (start.html). The server's pages get `senderDesktop`: the count on the
// app's icon and the window to the front when a notification is clicked
// (apps/web/src/features/sender/lib/notify.ts); the main process answers only the server it is
// signed in to.
/* global location */
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('sender', {
    signIn: (server) => ipcRenderer.invoke('sender:sign-in', server),
    ready: () => ipcRenderer.invoke('sender:ready'),
    onState: (listener) => ipcRenderer.on('sender:start', (_event, state) => listener(state)),
  });
} else {
  contextBridge.exposeInMainWorld('senderDesktop', {
    /** What counts on the app's icon (direct, groups, mentions, agents); 0 clears it. */
    setBadge: (count) => ipcRenderer.send('sender:badge', count),
    /** The window to the front – a notification was clicked. */
    show: () => ipcRenderer.send('sender:show'),
  });
}
