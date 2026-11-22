/**
 * `corrupt`: not a readable text document. `unsupported`: an OpenDocument file, but not a text.
 * `operation`: an operation that does not fit the document (a paragraph that is gone, …) – its
 * message is German and shown as it is.
 */
export type OdtErrorCode = 'corrupt' | 'unsupported' | 'operation';

export class OdtError extends Error {
  override name = 'OdtError';

  constructor(
    readonly code: OdtErrorCode,
    message: string,
  ) {
    super(message);
  }
}
