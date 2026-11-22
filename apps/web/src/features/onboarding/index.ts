/**
 * What other features take from onboarding: the choice of a workspace design to start on, the
 * kind and slide count of an AI-built deck, and the upload of a file as a new deck (dropped onto
 * „Präsentationen“ too).
 */
export { MasterChoice } from './components/BlankDeckCard';
export { UploadToast } from './components/UploadToast';
export { useDeckUpload } from './hooks/useDeckUpload';
export { KindChoice, PagesChoice } from './components/CreationChoices';
export { pagesOf } from './lib/deck-pages';
