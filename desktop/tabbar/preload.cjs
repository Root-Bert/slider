// The tab bar's only way to the main process: its state in, a pick, a close, a new name or a
// presentation's button (Präsentieren, Referentenansicht, Exportieren) out.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tabs', {
  onState: (listener) => ipcRenderer.on('tabs:state', (_event, state) => listener(state)),
  select: (id) => ipcRenderer.send('tabs:select', id),
  close: (id) => ipcRenderer.send('tabs:close', id),
  rename: (id, title) => ipcRenderer.send('tabs:rename', id, title),
  /** A name is being typed: the keys come here, not to the page in front. */
  typing: () => ipcRenderer.send('tabs:typing'),
  deckAction: (action) => ipcRenderer.send('tabs:deckAction', action),
});
