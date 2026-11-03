export {
  OdpDocument,
  type BackdropWork,
  isPackagePath,
  type EmbeddedFont,
  type OdpFontFile,
  picturePath,
  type OdpImage,
  type OdpDesign,
  type OdpElementSource,
  type OdpGuide,
  type OdpMasterPage,
  type OdpPicture,
  type OdpPlaceholderKind,
  type OdpTemplateLayout,
  type OdpSlide,
  slidePlaceholders,
  type LayerPlacement,
  placedBox,
} from './document';
export { OdpError, type OdpErrorCode } from './errors';
export { mergeSlide, renameStyles, sameSlide, type SlideConflict, type SlideMerge } from './merge';
export { ODP_MIME, OTP_MIME, isOdpBytes } from './archive';
export { imageSize } from './image-size';
export { creditText, frameIdShowing, swapPicture } from './credit';
export { blankOdp } from './blank';
export { revertChange, type RevertOutcome } from './revert';
