"""Locking the secret with a key, and unlocking it. See SPEC.md, section 3.

The encryption is AES-256-GCM from the `cryptography` package; none of it is
written here. GCM is "authenticated": unlocking with the wrong key, or after
a single bit of the locked secret or of the sheet's other details has
changed, fails outright. It never returns a wrong secret, which is why
recovery can trust what comes out.
"""

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

KEY_BYTES = 32
NONCE_BYTES = 12
TAG_BYTES = 16

# The secret is padded to one of these sizes, so a sheet shows roughly how
# long the secret is and no more. Two bytes of each are used for the length.
PADDED_SIZES = (64, 128, 256, 512)
MAX_SECRET_BYTES = PADDED_SIZES[-1] - 2
LOCKED_SIZES = tuple(size + TAG_BYTES for size in PADDED_SIZES)


def pad(secret: bytes) -> bytes:
    if not 1 <= len(secret) <= MAX_SECRET_BYTES:
        raise ValueError(f"the secret must be 1 to {MAX_SECRET_BYTES} bytes long")
    size = next(size for size in PADDED_SIZES if len(secret) + 2 <= size)
    return (len(secret).to_bytes(2, "big") + secret).ljust(size, b"\x00")


def unpad(block: bytes) -> bytes:
    length = int.from_bytes(block[:2], "big")
    secret, rest = block[2:2 + length], block[2 + length:]
    if len(block) not in PADDED_SIZES or len(secret) != length or length == 0 or any(rest):
        raise ValueError("not a padded secret")
    return secret


def lock(key: bytes, nonce: bytes, secret: bytes, authenticated: bytes) -> bytes:
    """Returns the locked secret: ciphertext with the 16-byte tag on the end.
    `authenticated` is not hidden, but unlocking fails if it has changed."""
    return AESGCM(key).encrypt(nonce, pad(secret), authenticated)


def unlock(key: bytes, nonce: bytes, locked: bytes, authenticated: bytes) -> bytes:
    """Raises ValueError if the key is wrong or anything has been altered."""
    try:
        return unpad(AESGCM(key).decrypt(nonce, locked, authenticated))
    except InvalidTag:
        raise ValueError("wrong key, or the sheet has been altered") from None
