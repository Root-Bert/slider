/**
 * Files handed to the next new mail – Cloud's „Per Mail senden“: fetched with one's own access
 * while the new mail opens, put on it as picked ones are (`useMailUploads`, its caps) once it
 * knows its mailbox. Taken once.
 */
let handed: Promise<File>[] = [];

export function handToNewMail(files: readonly Promise<File>[]): void {
  handed = [...handed, ...files];
}

export function takeHandedFiles(): Promise<File>[] {
  const now = handed;
  handed = [];
  return now;
}
