// Slider's pages in the app get a small bridge to this computer (BER-201): its files, the decks
// it keeps, signing it out. The same web app runs in the browser, where `window.sliderDesktop`
// does not exist – it asks for the bridge, not for the platform. The main process answers only
// Slider's own pages: this computer's and, signed in, the server's (online the tabs show those,
// live); deck ids are the page's own, the main process maps them to this computer's copies.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sliderDesktop', {
  /** What this computer adds: kept decks, decks that are a file here, platform, account. */
  state: () => ipcRenderer.invoke('desktop:state'),
  /** „Öffnen …“: the file dialog; the picked files open as tabs. */
  openFiles: () => ipcRenderer.invoke('files:open'),
  /** „Als Datei sichern …“: the save dialog; the presentation is that file from then on. */
  saveAs: (deckId, title) => ipcRenderer.invoke('files:save', deckId, title),
  /** „Im Finder zeigen“. */
  reveal: (deckId) => ipcRenderer.invoke('desktop:reveal', deckId),
  /** „Auf diesem Computer behalten“ on or off. */
  keep: (deckId, keep) => ipcRenderer.invoke('desktop:keep', deckId, keep),
  /** „Abmelden“: this computer signs out of the server. */
  signOut: () => ipcRenderer.invoke('desktop:signOut'),
  /** What the presentation offers in the tab bar, top right (`null`: nothing). */
  deckBar: (offer) => ipcRenderer.send('tabs:deckBar', offer),
});
