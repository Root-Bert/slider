/**
 * Subtitle of "Neue Review": names only the ways in this server offers – OneDrive/SharePoint
 * needs its Microsoft app, Nextcloud a connected account or the organisation's Nextcloud, Google
 * Drive its API key; upload and link always work.
 */
export function newReviewSubtitle(
  oneDriveAvailable: boolean,
  nextcloudAvailable = false,
  googleAvailable = false,
): string {
  const names = [
    ...(oneDriveAvailable ? ['OneDrive', 'SharePoint'] : []),
    ...(googleAvailable ? ['Google Drive'] : []),
    ...(nextcloudAvailable ? ['Nextcloud'] : []),
  ];
  const from =
    names.length > 1 ? `${names.slice(0, -1).join(', ')} oder ${names.at(-1)}` : names[0];
  return from
    ? `Präsentation aus ${from} öffnen und gemeinsam daran arbeiten.`
    : 'PowerPoint-Datei hochladen oder per Link öffnen und gemeinsam daran arbeiten.';
}
