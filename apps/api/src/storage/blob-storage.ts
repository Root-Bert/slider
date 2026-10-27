/**
 * Binary storage for PPTX originals, slide renders and avatars.
 * Filesystem today, S3-compatible later – callers only see keys.
 */
export interface BlobStorage {
  put(key: string, data: Uint8Array): Promise<void>;
  /** `null` when the key does not exist. */
  get(key: string): Promise<Uint8Array<ArrayBuffer> | null>;
  /** Size in bytes; `null` when the key does not exist. */
  size(key: string): Promise<number | null>;
  /** When the blob was last written; `null` when the key does not exist. */
  modifiedAt(key: string): Promise<Date | null>;
  /**
   * Streams the blob, or only the inclusive byte range – so serving a range of a long recording
   * reads just those bytes, never the whole file. `null` when the key does not exist.
   */
  stream(
    key: string,
    range?: { start: number; end: number },
  ): Promise<ReadableStream<Uint8Array> | null>;
  delete(key: string): Promise<void>;
  /** Removes every blob whose key starts with `prefix` (which must end in `/`). */
  deletePrefix(prefix: string): Promise<void>;
  /** Keys of every blob under `prefix` (which must end in `/`); `[]` when there are none. */
  list(prefix: string): Promise<string[]>;
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Keys are `/`-separated segments of `[A-Za-z0-9._-]`, never starting with a dot.
 * That rules out `..`, absolute paths, backslashes and hidden files in one rule.
 */
export function isValidKey(key: string): boolean {
  if (key.length === 0 || key.length > 512) return false;
  return key.split('/').every((segment) => SEGMENT.test(segment));
}

export function assertValidKey(key: string): void {
  if (!isValidKey(key)) throw new InvalidBlobKeyError(key);
}

export class InvalidBlobKeyError extends Error {
  constructor(key: string) {
    super(`Invalid blob key: ${JSON.stringify(key)}`);
    this.name = 'InvalidBlobKeyError';
  }
}

/** What a revision's original is stored as. */
export type DeckFileExtension = 'pptx' | 'pdf' | 'odp';

const CONTENT_TYPES: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  odp: 'application/vnd.oasis.opendocument.presentation',
  gif: 'image/gif',
  pdf: 'application/pdf',
  webm: 'video/webm',
  mp4: 'video/mp4',
  ogg: 'audio/ogg',
  ttf: 'font/ttf',
  otf: 'font/otf',
};

export function contentTypeForKey(key: string): string {
  const extension = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

/**
 * Key layout. Everything a deck owns lives under `decks/<deckId>/`, so deleting a deck
 * removes its files with one prefix delete (BER-121). `/files/*` only serves them through
 * signed, expiring links (`file-urls`).
 */
export const blobKeys = {
  deckPrefix: (deckId: string) => `decks/${deckId}/`,
  revisionPrefix: (deckId: string, revisionId: string) => `decks/${deckId}/${revisionId}/`,
  /**
   * The revision's original: a PowerPoint, a PDF review deck or an ODP. An edited ODP's working
   * copy and its undo snapshots live here too (BER-180).
   */
  pptx: (deckId: string, revisionId: string, extension: DeckFileExtension = 'pptx') =>
    `decks/${deckId}/${revisionId}/source-${crypto.randomUUID()}.${extension}`,
  slideRenderPrefix: (deckId: string, revisionId: string) =>
    `decks/${deckId}/${revisionId}/slides/`,
  slideRender: (deckId: string, revisionId: string, extension: string) =>
    `decks/${deckId}/${revisionId}/slides/${crypto.randomUUID()}.${extension}`,
  /**
   * A slide drawn with one text left out, which the editor types over; named by what it shows
   * (`OdpDocument.blankText`), so an equal picture is drawn once.
   */
  slideBackground: (deckId: string, revisionId: string, fingerprint: string) =>
    `decks/${deckId}/${revisionId}/backgrounds/${fingerprint}.jpg`,
  /**
   * An element's cutout for the live editor (`OdpDocument.toCutoutBytes`): its area and outline
   * as masks, and where on the slide they go (`json`); named by what they show.
   */
  elementCutout: (
    deckId: string,
    revisionId: string,
    fingerprint: string,
    part: 'fill' | 'stroke' | 'above' | 'box',
  ) =>
    `decks/${deckId}/${revisionId}/cutouts/${fingerprint}-${part}.${part === 'box' ? 'json' : 'png'}`,
  /**
   * A part of a slide taken apart for the layers view (`OdpDocument.toLayerBytes`): the slide
   * without its elements, or an element alone and where it goes (`json`) – named by what it shows,
   * wherever the element lies in the stack.
   */
  slideLayer: (
    deckId: string,
    revisionId: string,
    fingerprint: string,
    part: 'background' | 'image' | 'box',
  ) =>
    `decks/${deckId}/${revisionId}/layers/${fingerprint}-${part}.${
      part === 'background' ? 'jpg' : part === 'box' ? 'json' : 'png'
    }`,
  /** A picture uploaded for the editor; `imageId` is `<uuid>.<extension>` (BER-181). */
  editImage: (deckId: string, imageId: string) => `decks/${deckId}/edit-images/${imageId}`,
  editImages: (deckId: string) => `decks/${deckId}/edit-images/`,
  /** In the media store; same deck prefix, so deleting a deck clears its recordings too. */
  media: (deckId: string, mediaId: string, extension: string) =>
    `decks/${deckId}/media/${mediaId}.${extension}`,
  workspacePrefix: (workspaceId: string) => `workspaces/${workspaceId}/`,
  workspaceLogo: (workspaceId: string, extension: string) =>
    `workspaces/${workspaceId}/logo-${crypto.randomUUID()}.${extension}`,
  /** A face of a font the workspace uploaded (`workspace_fonts`). */
  workspaceFont: (workspaceId: string, fontId: string, extension: 'ttf' | 'otf') =>
    `workspaces/${workspaceId}/fonts/${fontId}.${extension}`,
  demoAsset: (fileName: string) => `demo/${crypto.randomUUID()}/${fileName}`,
};

export { fileUrl } from './file-urls';
