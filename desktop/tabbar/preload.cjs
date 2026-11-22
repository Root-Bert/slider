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
  /** „+“: a new tab at the app's start. */
  fresh: () => ipcRenderer.send('tabs:new'),
  /** The arrow beside it: what a new tab can start on, as a menu at that place of the bar. */
  freshMenu: (x, y) => ipcRenderer.send('tabs:newMenu', x, y),
  /** „Nebeneinander“ on or off. */
  split: () => ipcRenderer.send('tabs:split'),
  /** Files dragged out of a page were dropped onto a tab: `carried` is what the drag said. */
  drop: (id, carried) => ipcRenderer.send('tabs:drop', id, carried),
});
