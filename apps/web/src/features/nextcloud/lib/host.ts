/** `https://cloud.firma.de/` → `cloud.firma.de`. */
export const nextcloudHost = (server: string) => server.replace(/^https?:\/\//, '');
