import sodium from 'libsodium-wrappers';

/**
 * libsodium, the vetted library behind encryption at rest (BER-149). It loads asynchronously;
 * `loadSodium()` runs once on start (and in the test setup) before anything is sealed or opened.
 */
export { sodium };

export async function loadSodium(): Promise<void> {
  await sodium.ready;
}
