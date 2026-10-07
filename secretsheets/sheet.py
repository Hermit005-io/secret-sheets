"""What is on a sheet, and its layout in bytes. See SPEC.md, section 5.

Part A (`Locked`) is the same on every sheet of a set: the locked secret and
the details of the set. Part B (`Piece`) is that sheet's piece of the key.
"""

import datetime
import hashlib
from dataclasses import dataclass

from . import written
from .errors import Malformed, UnsupportedVersion
from .locking import KEY_BYTES, LOCKED_SIZES, NONCE_BYTES

VERSION = 1
MIN_SHEETS, MAX_SHEETS = 2, 20
MAX_LABEL_BYTES = 64
FINGERPRINT_BYTES = 8
PIECE_BYTES = 2 + KEY_BYTES


def is_printable(text: str) -> bool:
    """Whether `text` is free of control characters (line breaks, tabs and
    the like), which have no place in a label printed on one line."""
    return not any(ord(char) < 0x20 or 0x7F <= ord(char) <= 0x9F for char in text)


@dataclass(frozen=True)
class Piece:
    number: int     # which sheet: 1, 2, ...
    x: int          # the piece's coordinate (see shamir.py)
    y: bytes

    def fingerprint(self) -> bytes:
        digest = hashlib.sha256(b"secret sheet piece v1" + bytes([self.x]) + self.y)
        return digest.digest()[:FINGERPRINT_BYTES]

    def to_bytes(self) -> bytes:
        return bytes([self.number, self.x]) + self.y

    @classmethod
    def from_bytes(cls, data: bytes) -> "Piece":
        if len(data) != PIECE_BYTES:
            raise Malformed("Part B of this sheet is not the right length.")
        if data[0] == 0 or data[1] == 0:
            raise Malformed("Part B of this sheet is not a valid piece.")
        return cls(number=data[0], x=data[1], y=data[2:])


@dataclass(frozen=True)
class Locked:
    needed: int
    total: int
    made_on: datetime.date
    label: str
    nonce: bytes
    locked: bytes                       # the encrypted secret and its tag
    fingerprints: tuple[bytes, ...]     # of every piece in the set, in sheet order

    def details(self) -> bytes:
        """Everything about the set that comes before the locked secret."""
        label = self.label.encode("utf-8")
        return (bytes([VERSION, self.needed, self.total])
                + self.made_on.year.to_bytes(2, "big")
                + bytes([self.made_on.month, self.made_on.day, len(label)]) + label)

    def authenticated(self) -> bytes:
        """What the encryption vouches for besides the secret (SPEC.md, 5.3)."""
        return self.details() + b"".join(self.fingerprints)

    def to_bytes(self) -> bytes:
        return (self.details() + self.nonce + len(self.locked).to_bytes(2, "big")
                + self.locked + b"".join(self.fingerprints))

    def set_code(self) -> str:
        """Twelve characters people can read to each other to confirm they
        hold sheets from the same set."""
        digest = hashlib.sha256(b"secret sheet set v1" + self.to_bytes()).digest()
        code = written.to_text(digest[:8])[:12]
        return "-".join(code[i:i + 4] for i in range(0, 12, 4))

    @classmethod
    def from_bytes(cls, data: bytes) -> "Locked":
        locked, rest = cls._read(data)
        if rest:
            raise Malformed("Part A of this sheet is longer than it should be.")
        return locked

    @classmethod
    def _read(cls, data: bytes) -> tuple["Locked", bytes]:
        """Read Part A from the front of `data`; return it and what follows."""
        reader = _Reader(data)
        version = reader.take(1)[0]
        if version != VERSION:
            raise UnsupportedVersion(
                f"This sheet uses format version {version}. This program reads version "
                f"{VERSION}. A newer copy of the tool may be needed.")
        needed, total = reader.take(2)
        if not (MIN_SHEETS <= total <= MAX_SHEETS and 2 <= needed <= total):
            raise Malformed("This sheet's numbers (how many sheets, how many needed) "
                            "make no sense.")
        year = int.from_bytes(reader.take(2), "big")
        month, day, label_length = reader.take(3)
        try:
            made_on = datetime.date(year, month, day)
        except ValueError:
            raise Malformed("This sheet's date is not a real date.") from None
        if label_length > MAX_LABEL_BYTES:
            raise Malformed("This sheet's label is too long.")
        try:
            label = reader.take(label_length).decode("utf-8")
        except UnicodeDecodeError:
            raise Malformed("This sheet's label is not readable text.") from None
        if not is_printable(label):
            raise Malformed("This sheet's label is not readable text.")
        nonce = reader.take(NONCE_BYTES)
        locked_length = int.from_bytes(reader.take(2), "big")
        if locked_length not in LOCKED_SIZES:
            raise Malformed("This sheet's locked secret is not a possible size.")
        locked = reader.take(locked_length)
        fingerprints = tuple(reader.take(FINGERPRINT_BYTES) for _ in range(total))
        return cls(needed, total, made_on, label, nonce, locked, fingerprints), reader.rest()


@dataclass(frozen=True)
class Sheet:
    locked: Locked
    piece: Piece

    def to_bytes(self) -> bytes:
        return self.locked.to_bytes() + self.piece.to_bytes()

    @classmethod
    def from_bytes(cls, data: bytes) -> "Sheet":
        locked, rest = Locked._read(data)
        return cls(locked, Piece.from_bytes(rest))

    def piece_is_intact(self) -> bool:
        """Whether this sheet's piece is the one its own Part A expects."""
        number = self.piece.number
        return (1 <= number <= self.locked.total
                and self.piece.fingerprint() == self.locked.fingerprints[number - 1])


class _Reader:
    def __init__(self, data: bytes):
        self._data = data
        self._at = 0

    def take(self, count: int) -> bytes:
        chunk = self._data[self._at:self._at + count]
        if len(chunk) != count:
            raise Malformed("This sheet is incomplete: part of it is missing.")
        self._at += count
        return chunk

    def rest(self) -> bytes:
        return self._data[self._at:]
