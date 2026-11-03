import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { installChunkReload } from './app/chunk-reload';
import { watchPointer } from './lib/dom';
import { installOffline } from './lib/offline';
import { installTheme } from './lib/theme';
import './styles/index.css';

installChunkReload();
installOffline();
installTheme();
// From the start: a click in the Projekte already counts in the (lazy) viewer – see useViewerShortcuts.
watchPointer();

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
