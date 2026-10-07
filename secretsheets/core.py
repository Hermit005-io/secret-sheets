"""Making a set of sheets from a secret, and getting the secret back.

    sheets = split_secret("correct horse battery staple", needed=3, total=5)
    recover_secret(sheets[:3])      # -> "correct horse battery staple"

Making a set (SPEC.md, sections 3 to 5):
    1. make a random key and lock the secret with it;
    2. split the key into pieces, one per sheet;
    3. put the locked secret and one piece on each sheet.

Recovery is strict on purpose. Before anything is unlocked, every sheet must
belong to the same set and every piece must match its fingerprint, so that
when something is wrong the person is told which sheet, not merely that
"it didn't work". And nothing is ever returned unless the encryption itself
accepted the rebuilt key.
"""

import datetime
import secrets
from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import dataclass

from . import locking, shamir, written
from .errors import CannotUnlock, Malformed, MixedSets, SheetError, TooFew, WrongPiece
from .sheet import (
    MAX_LABEL_BYTES,
    MAX_SHEETS,
    MIN_SHEETS,
    Locked,
    Piece,
    Sheet,
    is_printable,
)


def split_secret(secret: str, needed: int, total: int, label: str = "", *,
                 made_on: datetime.date | None = None,
                 random_bytes: Callable[[int], bytes] = secrets.token_bytes) -> list[Sheet]:
    """Make `total` sheets, any `needed` of which recover `secret`.

    `label` is printed on every sheet for anyone to read, so it must not give
    the secret away. `random_bytes` is only ever replaced in tests, to make
    the output repeatable.
    """
    check_rule(needed, total, label)
    try:
        secret_bytes = secret.encode("utf-8")
    except UnicodeEncodeError:
        raise ValueError("The secret contains something that is not a character and "
                         "cannot be stored.") from None
    if not secret_bytes:
        raise ValueError("There is no secret to split.")
    if len(secret_bytes) > locking.MAX_SECRET_BYTES:
        raise ValueError(f"The secret is too long: {len(secret_bytes)} bytes, and the most a "
                         f"sheet can hold is {locking.MAX_SECRET_BYTES}.")

    key = random_bytes(locking.KEY_BYTES)
    nonce = random_bytes(locking.NONCE_BYTES)
    if len(key) != locking.KEY_BYTES or len(nonce) != locking.NONCE_BYTES:
        raise RuntimeError("the random source returned the wrong number of bytes")

    xs = range(1, total + 1)
    pieces = [Piece(number=x, x=x, y=y)
              for x, y in zip(xs, shamir.split(key, needed, xs, random_bytes), strict=True)]

    # The set's details and fingerprints are vouched for by the encryption,
    # so they have to exist before the secret is locked.
    unsealed = Locked(needed, total, made_on or datetime.date.today(), label, nonce,
                      locked=b"", fingerprints=tuple(p.fingerprint() for p in pieces))
    locked = Locked(needed, total, unsealed.made_on, label, nonce,
                    locking.lock(key, nonce, secret_bytes, unsealed.authenticated()),
                    unsealed.fingerprints)
    sheets = [Sheet(locked, piece) for piece in pieces]

    # Never hand back sheets that have not been shown to work. Each one must
    # survive being written out and read back, and the secret must return
    # from the first sheets, from the last, and from all of them at once.
    try:
        reread = [read_sheet(written.qr_text(sheet.to_bytes())) for sheet in sheets]
        works = reread == sheets and all(
            recover_secret(some) == secret
            for some in (reread[:needed], reread[-needed:], reread))
    except SheetError:
        works = False
    if not works:
        raise RuntimeError("the new sheets failed their own recovery check")
    return sheets


def check_rule(needed: int, total: int, label: str = "") -> None:
    """Raise ValueError if a set cannot be made with this rule and label."""
    if not MIN_SHEETS <= total <= MAX_SHEETS:
        raise ValueError(f"The number of sheets must be from {MIN_SHEETS} to {MAX_SHEETS}.")
    if not 2 <= needed <= total:
        raise ValueError("The number needed must be at least 2 and no more than the "
                         "number of sheets.")
    try:
        label_bytes = label.encode("utf-8")
    except UnicodeEncodeError:
        raise ValueError("The label contains something that is not a character and "
                         "cannot be stored.") from None
    if len(label_bytes) > MAX_LABEL_BYTES:
        raise ValueError(f"The label is too long (the limit is {MAX_LABEL_BYTES} bytes).")
    if not is_printable(label):
        raise ValueError("The label must be plain text on one line.")


def recover_secret(sheets: Iterable[Sheet], extra_pieces: Iterable[Piece] = ()) -> str:
    """The secret, from at least `needed` different sheets of one set.

    `extra_pieces` are for sheets typed in by hand, where the person enters
    Part A once and then only Part B of each other sheet.

    Raises a SheetError saying what is wrong, and with which sheet if that
    can be known. The order of the checks is fixed (SPEC.md, section 7).
    """
    sheets = list(sheets)
    if not sheets:
        raise TooFew("At least one complete sheet is needed: Part A as well as Part B.")
    locked = _the_one_set(sheets)

    pieces: dict[int, Piece] = {}
    for piece in [sheet.piece for sheet in sheets] + list(extra_pieces):
        if not 1 <= piece.number <= locked.total:
            raise WrongPiece(f"Sheet {piece.number} cannot belong to this set, which has only "
                             f"{locked.total} sheets.")
        if piece.fingerprint() != locked.fingerprints[piece.number - 1]:
            raise WrongPiece(f"Sheet {piece.number}'s piece is damaged, or it comes from a "
                             "different set.")
        pieces[piece.number] = piece

    if len(pieces) < locked.needed:
        raise TooFew(f"{locked.needed} different sheets are needed, and so far there "
                     f"{'is' if len(pieces) == 1 else 'are'} {len(pieces)}.")

    points = [(piece.x, piece.y) for piece in pieces.values()]
    if len({x for x, _ in points}) != len(points):
        raise Malformed("Two of these sheets hold the same piece under different numbers. "
                        "A set made properly never does.")
    key = shamir.combine(points)
    try:
        secret = locking.unlock(key, locked.nonce, locked.locked, locked.authenticated())
        return secret.decode("utf-8")
    except ValueError:
        # Every piece matched its fingerprint and still the key is wrong:
        # Part A itself must have been rewritten on every sheet given.
        raise CannotUnlock("These sheets agree with each other but do not unlock the secret. "
                           "They may all have been altered.") from None


def _the_one_set(sheets: list[Sheet]) -> Locked:
    """The Part A all the sheets share. Raises MixedSets if they don't."""
    count = Counter(sheet.locked.to_bytes() for sheet in sheets)
    if len(count) == 1:
        return sheets[0].locked
    (majority, votes), (_, runner_up) = count.most_common(2)
    if votes == runner_up:
        codes = sorted({sheet.locked.set_code() for sheet in sheets})
        raise MixedSets("These sheets are not all from the same set, or one has been altered "
                        f"(set codes: {', '.join(codes)}).")
    odd = sorted(sheet.piece.number for sheet in sheets if sheet.locked.to_bytes() != majority)
    which = f"Sheet {odd[0]} does" if len(odd) == 1 else \
        f"Sheets {', '.join(map(str, odd))} do"
    raise MixedSets(f"{which} not belong with the others: a different set, or altered.")


# ---- reading sheets from text ---------------------------------------------------------
def read_parts(text: str) -> tuple[Locked | None, Piece | None]:
    """Whatever `text` contains of a sheet: the QR code's text, or typed lines
    (both parts, or only one)."""
    if written.is_qr_text(text):
        sheet = Sheet.from_bytes(written.from_qr_text(text))
        return sheet.locked, sheet.piece
    parts = written.read_typed_lines(text)
    if not parts:
        raise Malformed("No sheet was found here. A sheet's lines start with A01, A02 and "
                        "so on, then B01 to B04.")
    return (Locked.from_bytes(parts["A"]) if "A" in parts else None,
            Piece.from_bytes(parts["B"]) if "B" in parts else None)


def read_sheet(text: str) -> Sheet:
    """A complete sheet from its text. Raises Malformed if a part is missing."""
    locked, piece = read_parts(text)
    if locked is None or piece is None:
        missing = "Part A" if locked is None else "Part B"
        raise Malformed(f"{missing} of this sheet was not found.")
    return Sheet(locked, piece)


# ---- checking one sheet ------------------------------------------------------------------
@dataclass(frozen=True)
class Checkup:
    intact: bool
    number: int
    needed: int
    total: int
    made_on: datetime.date
    label: str
    set_code: str


def check_sheet(sheet: Sheet) -> Checkup:
    """What a sheet says about itself, and whether its piece is intact.
    Reveals nothing about the secret."""
    locked = sheet.locked
    return Checkup(sheet.piece_is_intact(), sheet.piece.number, locked.needed, locked.total,
                   locked.made_on, locked.label, locked.set_code())
