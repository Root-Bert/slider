/** Full page load after signing in: the session cookie is set, everything cached belongs to "signed out". */
export const loadPage = (path: string) => window.location.assign(path);
