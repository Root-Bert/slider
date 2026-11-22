// The start page's bridge (start.html). The server's pages get this computer's files
// (`cloudDesktop`, apps/web/src/features/cloud/lib/computer.ts); the main process answers only
// the server it is signed in to.
/* global location */
const { contextBridge, ipcRenderer } = require('electron');

if (location.protocol === 'file:') {
  contextBridge.exposeInMainWorld('cloud', {
    signIn: (server) => ipcRenderer.invoke('cloud:sign-in', server),
    ready: () => ipcRenderer.invoke('cloud:ready'),
    onState: (listener) => ipcRenderer.on('cloud:start', (_event, state) => listener(state)),
  });
} else {
  contextBridge.exposeInMainWorld('cloudDesktop', {
    /** The apps' pages open in this window's tabs: the page offers the way there. */
    tabs: true,
    /**
     * Where each app's pages open: `{ slider, writer, reader, sender }`, each `{ where, installed }` – `tab` (in
     * this window) or `own` (in the app of its own, if `installed`).
     */
    apps: () => ipcRenderer.invoke('cloud:apps'),
    setApp: (name, where) => ipcRenderer.invoke('cloud:set-app', name, where),
    /** Opens the file where it lies in the Finder, in its own program. */
    open: (workspaceId, nodeId) => ipcRenderer.invoke('cloud:open', workspaceId, nodeId),
    /** The ids of the files whose content is on this computer. */
    local: (workspaceId) => ipcRenderer.invoke('cloud:local', workspaceId),
    /** Shows the file where it lies in the Finder. */
    reveal: (workspaceId, nodeId) => ipcRenderer.invoke('cloud:reveal', workspaceId, nodeId),
    /** Its content leaves this computer; the file stays and is fetched again when opened. */
    free: (workspaceId, nodeId) => ipcRenderer.invoke('cloud:free', workspaceId, nodeId),
  });
}
