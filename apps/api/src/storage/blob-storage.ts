/**
 * Binary storage for PPTX originals, slide renders and avatars.
 * Filesystem today, S3-compatible later – callers only see keys.
 */
export interface BlobStorage {
  put(key: string, data: Uint8Array): Promise<void>;
  /** `null` when the key does not exist. */
  get(key: string): Promise<Uint8Array<ArrayBuffer> | null>;
  delete(key: string): Promise<void>;
  /** Removes every blob whose key starts with `prefix` (which must end in `/`). */
  deletePrefix(prefix: string): Promise<void>;
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

const CONTENT_TYPES: Record<string, string> = {
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  webm: 'video/webm',
  mp4: 'video/mp4',
  ogg: 'audio/ogg',
};

export function contentTypeForKey(key: string): string {
  const extension = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
  return CONTENT_TYPES[extension] ?? 'application/octet-stream';
}

/**
 * Key layout. Everything a deck owns lives under `decks/<deckId>/`, so deleting a deck
 * removes its files with one prefix delete (BER-121). Every key contains a random UUID,
 * which is what makes `/files/*` safe to serve without a session check for now.
 */
export const blobKeys = {
  deckPrefix: (deckId: string) => `decks/${deckId}/`,
  revisionPrefix: (deckId: string, revisionId: string) => `decks/${deckId}/${revisionId}/`,
  pptx: (deckId: string, revisionId: string) =>
    `decks/${deckId}/${revisionId}/source-${crypto.randomUUID()}.pptx`,
  slideRenderPrefix: (deckId: string, revisionId: string) =>
    `decks/${deckId}/${revisionId}/slides/`,
  slideRender: (deckId: string, revisionId: string, extension: string) =>
    `decks/${deckId}/${revisionId}/slides/${crypto.randomUUID()}.${extension}`,
  /** In the media store; same deck prefix, so deleting a deck clears its recordings too. */
  media: (deckId: string, mediaId: string, extension: string) =>
    `decks/${deckId}/media/${mediaId}.${extension}`,
  avatar: (extension: string) => `avatars/${crypto.randomUUID()}.${extension}`,
  demoAsset: (fileName: string) => `demo/${crypto.randomUUID()}/${fileName}`,
};

export const fileUrl = (key: string) => `/files/${key}`;
