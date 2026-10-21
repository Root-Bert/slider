import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { installChunkReload } from './app/chunk-reload';
import { watchPointer } from './lib/dom';
import './styles/index.css';

installChunkReload();
// From the start: a click on Reviews already counts in the (lazy) viewer – see useViewerShortcuts.
watchPointer();

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
