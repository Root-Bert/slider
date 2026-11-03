/**
 * `corrupt`: not a readable ODP. `unsupported`: an ODF file, but not a presentation.
 * `operation`: an operation that does not fit the deck (unknown element, wrong kind, …).
 *
 * The message of an `operation` error a person can meet – an edit, an undo, a change of the AI
 * going in – is German and says what is wrong without ids or numbers of the file: the API shows
 * it as it is. Those only the AI meets while it works on its copy (XML it wrote, a slide number
 * it gave) are English, for it to correct; so are those of a file that cannot be read, which
 * the API replaces by its own.
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
