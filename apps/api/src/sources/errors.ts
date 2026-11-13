import { ApiError } from '../http/errors';

// Errors every source adapter may throw; the web app reacts to the codes (A3 card).

export const sourceForbidden = (message = 'Slider hat keinen Zugriff auf diese Datei.') =>
  new ApiError(403, 'source_forbidden', message);

export const sourceNotFound = () =>
  new ApiError(
    404,
    'source_not_found',
    'Die Datei wurde nicht gefunden – der Link ist abgelaufen oder wurde gelöscht.',
  );

export const sourceUnreachable = (
  message = 'Der Link konnte gerade nicht geladen werden. Bitte versuche es gleich noch einmal.',
) => new ApiError(502, 'source_unreachable', message);

/** A cloud link that leads to a folder rather than a file. */
export const LINK_IS_A_FOLDER_MESSAGE =
  'Unter diesem Link liegt ein Ordner – wähle eine Datei darin.';

export const LINK_NOT_A_POWERPOINT_MESSAGE =
  'Unter diesem Link liegt keine PowerPoint-Datei (.pptx) und kein PDF.';
