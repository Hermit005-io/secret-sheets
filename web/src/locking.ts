// Locking the secret with a key, and unlocking it. See SPEC.md, section 3.
//
// The encryption is AES-256-GCM from the browser's own Web Crypto; none of it
// is written here. GCM is "authenticated": unlocking with the wrong key, or
// after a single bit of the locked secret or of the sheet's other details has
// changed, fails outright. It never returns a wrong secret.

export const KEY_BYTES = 32;
export const NONCE_BYTES = 12;
const TAG_BYTES = 16;

// The secret is padded to one of these sizes, so a sheet shows roughly how
// long the secret is and no more. Two bytes of each are used for the length.
export const PADDED_SIZES = [64, 128, 256, 512];
export const MAX_SECRET_BYTES = 510;
export const LOCKED_SIZES = PADDED_SIZES.map(size => size + TAG_BYTES);

export function pad(secret: Uint8Array): Uint8Array {
  const size = PADDED_SIZES.find(size => secret.length + 2 <= size);
  if (secret.length < 1 || size === undefined) {
    throw new RangeError(`the secret must be 1 to ${MAX_SECRET_BYTES} bytes long`);
  }
  const block = new Uint8Array(size);
  block[0] = secret.length >> 8;
  block[1] = secret.length & 0xff;
  block.set(secret, 2);
  return block;
}

export function unpad(block: Uint8Array): Uint8Array {
  const length = ((block[0] ?? 0) << 8) | (block[1] ?? 0);
  const fits = PADDED_SIZES.includes(block.length) && length >= 1 && length + 2 <= block.length;
  if (!fits || block.subarray(2 + length).some(byte => byte !== 0)) {
    throw new Error('not a padded secret');
  }
  return block.slice(2, 2 + length);
}

async function aesKey(key: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', key as BufferSource, 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * Returns the locked secret: ciphertext with the 16-byte tag on the end.
 * `authenticated` is not hidden, but unlocking fails if it has changed.
 */
export async function lock(
  key: Uint8Array,
  nonce: Uint8Array,
  secret: Uint8Array,
  authenticated: Uint8Array,
): Promise<Uint8Array> {
  const algorithm = {name: 'AES-GCM', iv: nonce as BufferSource, additionalData: authenticated as BufferSource};
  const locked = await crypto.subtle.encrypt(algorithm, await aesKey(key), pad(secret) as BufferSource);
  return new Uint8Array(locked);
}

/** Throws if the key is wrong or anything has been altered. */
export async function unlock(
  key: Uint8Array,
  nonce: Uint8Array,
  locked: Uint8Array,
  authenticated: Uint8Array,
): Promise<Uint8Array> {
  const algorithm = {name: 'AES-GCM', iv: nonce as BufferSource, additionalData: authenticated as BufferSource};
  const block = await crypto.subtle.decrypt(algorithm, await aesKey(key), locked as BufferSource);
  return unpad(new Uint8Array(block));
}
