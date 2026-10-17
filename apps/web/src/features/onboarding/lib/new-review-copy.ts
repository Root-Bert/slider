/**
 * Subtitle of "Neue Review": names only the ways in this server offers – OneDrive/SharePoint
 * needs its Microsoft app, upload and link always work.
 */
export const newReviewSubtitle = (oneDriveAvailable: boolean): string =>
  oneDriveAvailable
    ? 'Präsentation aus OneDrive oder SharePoint öffnen und Feedback direkt auf den Folien sammeln.'
    : 'PowerPoint-Datei hochladen oder per Link öffnen und Feedback direkt auf den Folien sammeln.';
