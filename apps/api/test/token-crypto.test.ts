import { describe, expect, it } from 'vitest';
import { decryptToken, encryptToken, toBase64Url } from '../src/auth/token-crypto';

const SECRET = 'test-secret-test-secret-test-secret!';

describe('token encryption', () => {
  it('round-trips, with a fresh IV every time', async () => {
    const a = await encryptToken(SECRET, 'refresh-token');
    const b = await encryptToken(SECRET, 'refresh-token');
    expect(a).toMatch(/^v1\.[\w-]+\.[\w-]+$/);
    expect(a).not.toBe(b);
    expect(await decryptToken(SECRET, a)).toBe('refresh-token');
    expect(await decryptToken(SECRET, b)).toBe('refresh-token');
  });

  it('uses one key per purpose', async () => {
    const sealed = await encryptToken(SECRET, 'smtp-password', 'settings');
    expect(await decryptToken(SECRET, sealed, 'settings')).toBe('smtp-password');
    await expect(decryptToken(SECRET, sealed)).rejects.toThrow();
  });

  it('cannot be read with another secret', async () => {
    const sealed = await encryptToken(SECRET, 'refresh-token');
    await expect(decryptToken(`${SECRET}-rotated`, sealed)).rejects.toThrow();
  });

  it('rejects tampered ciphertexts and unknown formats', async () => {
    const sealed = await encryptToken(SECRET, 'refresh-token');
    const [version, iv, ciphertext = ''] = sealed.split('.');
    const flipped = Buffer.from(ciphertext, 'base64url');
    flipped[0] = (flipped[0] ?? 0) ^ 0xff;
    await expect(
      decryptToken(SECRET, [version, iv, toBase64Url(flipped)].join('.')),
    ).rejects.toThrow();
    await expect(decryptToken(SECRET, `v2.${iv}.${ciphertext}`)).rejects.toThrow(
      'Unknown token format',
    );
    await expect(decryptToken(SECRET, 'v1..')).rejects.toThrow('Unknown token format');
    await expect(decryptToken(SECRET, 'garbage')).rejects.toThrow('Unknown token format');
  });

  it('encodes base64url without padding', () => {
    expect(toBase64Url(new Uint8Array([0xfb, 0xff]))).toBe('-_8');
  });
});
