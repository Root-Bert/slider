/*
 * Editing a deck in Slider (BER-180): the deck's current revision is the working copy, every
 * edit a step of its history (`steps`), committed with its slides drawn anew (`commit`).
 */
export { drawSlides } from './drawing';
export { editedSlidePdf, editedSlidePng, sendExport } from './export';
export { fileSlides } from './file-slides';
export { MAX_EDIT_IMAGE_BYTES, loadEditImage, storeEditImage, uploadEditImage } from './images';
export { liveParagraphsOf } from './live-texts';
export { editedFile, editedPdf, filePicture, getEditState, uploadedPicture } from './state';
export { withProposalLock } from './lock';
export { NotThatStep, applyEdit, editFile, moveAiStep, revertEdit } from './steps';
export {
  editTarget,
  openFile,
  readFile,
  slideIdsOf,
  withFileProblems,
  type EditTarget,
} from './target';
