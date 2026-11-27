/** What other features take from Writer. */
export { DocumentTemplates } from './components/DocumentTemplates';
export { DOCUMENT_TEMPLATES } from './lib/templates';
/** A Markdown page (`features/pages`) sends its lines as Writer's steps. */
export { applySteps, inRequests, stepsBetween } from './lib/model';
/** A page speaks to its document's AI as Writer does (`features/pages/components/PageAgent.tsx`). */
export {
  DocumentVoiceProvider,
  useWriterVoice,
  type DocumentVoiceLook,
} from './voice/WriterVoiceProvider';
