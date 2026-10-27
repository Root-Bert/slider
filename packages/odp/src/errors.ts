/**
 * `corrupt`: not a readable ODP. `unsupported`: an ODF file, but not a presentation.
 * `operation`: an operation that does not fit the deck (unknown element, wrong kind, …).
 */
export type OdpErrorCode = 'corrupt' | 'unsupported' | 'operation';

export class OdpError extends Error {
  override name = 'OdpError';

  constructor(
    readonly code: OdpErrorCode,
    message: string,
  ) {
    super(message);
  }
}
