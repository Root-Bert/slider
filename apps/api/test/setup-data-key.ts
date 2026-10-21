import { useDataKey } from '../src/crypto/content-crypto';
import { dataKeyFromBytes } from '../src/crypto/data-key';
import { loadSodium } from '../src/crypto/sodium';

/** Every API test writes through the encrypted columns (BER-149); one fixed key for all. */
await loadSodium();
export const TEST_DATA_KEY = dataKeyFromBytes(new Uint8Array(32).fill(7));
useDataKey(TEST_DATA_KEY);
