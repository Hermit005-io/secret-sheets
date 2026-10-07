"""Write tests/vectors/sheets_v1.json: sets of sheets with the secret each
must give back, and damaged ones with the failure each must produce.

    python tools/make_sheet_vectors.py

The same file is read by the Python tests and by the web version's tests, so
the two cannot quietly disagree about what a sheet means. The "random" bytes
here come from a fixed, published recipe (SHA-256 of a counter), which makes
the file exactly reproducible: running this again must change nothing.
"""

import datetime
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from secretsheets import split_secret, written  # noqa: E402
from secretsheets.sheet import Locked, Piece, Sheet  # noqa: E402

MADE_ON = datetime.date(2026, 10, 7)


def fixed_bytes(seed: str):
    """A stand-in for the random generator: SHA-256(seed, counter), end to end."""
    counter = 0

    def take(count: int) -> bytes:
        nonlocal counter
        out = b""
        while len(out) < count:
            out += hashlib.sha256(f"{seed}/{counter}".encode()).digest()
            counter += 1
        return out[:count]

    return take


def make(name: str, secret: str, needed: int, total: int, label: str = "") -> list[Sheet]:
    return split_secret(secret, needed, total, label, made_on=MADE_ON,
                        random_bytes=fixed_bytes(name))


def qr(sheets) -> list[str]:
    return [written.qr_text(sheet.to_bytes()) for sheet in sheets]


def with_byte_changed(sheet: Sheet, position: int) -> str:
    """The sheet's QR text with one byte altered. A negative position counts
    from the end, which is where the piece is."""
    data = bytearray(sheet.to_bytes())
    data[position] ^= 0x01
    return written.qr_text(bytes(data))


def sharing_a_coordinate(first: Sheet, second: Sheet) -> list[Sheet]:
    """Two sheets with different numbers whose pieces sit at the same x, in a
    Part A rewritten to match. No honest set looks like this."""
    old = first.locked
    twin = Piece(second.piece.number, first.piece.x, second.piece.y)
    prints = list(old.fingerprints)
    prints[twin.number - 1] = twin.fingerprint()
    forged = Locked(old.needed, old.total, old.made_on, old.label, old.nonce, old.locked,
                    tuple(prints))
    return [Sheet(forged, first.piece), Sheet(forged, twin)]


def relabelled(sheet: Sheet, label: str) -> Sheet:
    old = sheet.locked
    return Sheet(Locked(old.needed, old.total, old.made_on, label, old.nonce, old.locked,
                        old.fingerprints), sheet.piece)


def misread(line: str) -> str:
    """A typed line as someone who takes 0 for O and 1 for l would copy it. In
    the line number one real digit is kept: with none, it reads as a word."""
    number = line[1:3]
    if number[0] == "0" and number[1] not in "01":
        number = "O" + number[1]
    return line[0] + number + line[3:].replace("0", "O").replace("1", "l")


def build() -> dict:
    valid = []
    for name, secret, needed, total, label in [
        ("two of two", "hunter2", 2, 2, ""),
        ("three of five", "correct horse battery staple", 3, 5, "Email recovery codes"),
        ("all twenty", "0000", 20, 20, "Safe"),
        ("two of twenty", "x", 2, 20, ""),
        ("not only English", "pässwörd ключ 密碼 🔑", 2, 3, "Clé de secours"),
        ("spaces kept", "  leading and trailing  ", 2, 3, ""),
        ("fills 64", "a" * 62, 2, 3, ""),
        ("just over 64", "b" * 63, 2, 3, ""),
        ("fills 128", "c" * 126, 3, 4, ""),
        ("fills 256", "d" * 254, 3, 4, ""),
        ("longest", "e" * 510, 4, 7, "x" * 64),
    ]:
        sheets = make(name, secret, needed, total, label)
        valid.append({"name": name, "secret": secret, "needed": needed,
                      "set_code": sheets[0].locked.set_code(), "sheets": qr(sheets)})

    base = make("three of five", "correct horse battery staple", 3, 5, "Email recovery codes")
    other = make("another set", "something else entirely", 3, 5, "Email recovery codes")
    version_2 = bytearray(base[0].to_bytes())
    version_2[0] = 2

    invalid = [
        {"name": "one sheet short", "expect": "too-few", "sheets": qr(base[:2])},
        {"name": "the same sheet three times", "expect": "too-few",
         "sheets": qr([base[0], base[0], base[0]])},
        {"name": "a sheet from another set, outnumbered", "expect": "mixed-sets",
         "sheets": qr([base[0], base[1], other[2]])},
        {"name": "two sets, one sheet each", "expect": "mixed-sets",
         "sheets": qr([base[0], other[1]])},
        {"name": "one byte of a piece changed", "expect": "wrong-piece",
         "sheets": [*qr(base[:2]), with_byte_changed(base[2], -1)]},
        {"name": "a piece's coordinate changed", "expect": "wrong-piece",
         "sheets": [*qr(base[:2]), with_byte_changed(base[2], -33)]},
        {"name": "one byte of the locked secret changed, on one sheet", "expect": "mixed-sets",
         "sheets": [*qr(base[:2]), with_byte_changed(base[2], 60)]},
        {"name": "the label rewritten on every sheet", "expect": "cannot-unlock",
         "sheets": qr([relabelled(sheet, "Bank") for sheet in base[:3]])},
        {"name": "cut short", "expect": "malformed",
         "sheets": [*qr(base[:2]), qr(base[2:3])[0][:-8]]},
        {"name": "a later format version", "expect": "unsupported-version",
         "sheets": [written.qr_text(bytes(version_2))]},
        {"name": "not a sheet at all", "expect": "malformed", "sheets": ["https://example.com"]},
        {"name": "two sheets at the same coordinate", "expect": "malformed",
         "sheets": qr(sharing_a_coordinate(*make("two of two", "hunter2", 2, 2)))},
        {"name": "a label holding a line break", "expect": "malformed",
         "sheets": qr([relabelled(base[0], "Email\nB01 0000")])},
        {"name": "words that only begin like a line", "expect": "malformed",
         "sheets": ["All of them.\nBill has one.\nA\u0660\u0661 0000\nBoo"]},
    ]

    lines = written.typed_lines("B", base[0].piece.to_bytes())
    label, data = lines[1][:5], lines[1][5:]
    at = next(i for i in range(3) if data[i] != data[i + 1])
    swapped = label + data[:at] + data[at + 1] + data[at] + data[at + 2:]
    whole = written.typed_lines("A", base[0].locked.to_bytes()) + lines
    bare = [line.replace(" ", "").replace("-", "") for line in whole]
    typed = {
        "part_a": written.typed_lines("A", base[0].locked.to_bytes()),
        "part_b": [written.typed_lines("B", sheet.piece.to_bytes()) for sheet in base],
        "secret": "correct horse battery staple",
        # Every one of these must read as sheet 1 of "three of five".
        "as_people_type": [
            {"name": "small letters, no dashes",
             "text": "\n".join(whole).lower().replace("-", "")},
            {"name": "no spaces or dashes at all", "text": "\n".join(bare)},
            {"name": "letter O for zero and letter l for one",
             "text": "\n".join(misread(line) for line in whole)},
            {"name": "a colon after each line number",
             "text": "\n".join(line[:3] + ":" + line[5:] for line in whole)},
            {"name": "old Mac line endings", "text": "\r".join(whole)},
            {"name": "Windows line endings, after a byte-order mark",
             "text": "\ufeff" + "\r\n".join(whole)},
            {"name": "among other words, indented",
             "text": "\n".join(["Sheet 1", "", *("\t  " + line for line in whole), "The end."])},
        ],
        "bad_lines": [
            {"name": "two characters swapped", "line": swapped},
            {"name": "typed on the wrong line", "line": "B03" + lines[1][3:]},
            {"name": "typed under the wrong part", "line": "A" + lines[1][1:]},
            {"name": "last character missing", "line": lines[1][:-1]},
            {"name": "a letter from another alphabet",
             "line": label + "\u00df" + data[1:]},
            {"name": "a digit from another alphabet",
             "line": label + "\u0660" + data[1:]},
            {"name": "far too long", "line": lines[1] + "0" * 40},
            {"name": "ending in a line separator that is not a line break",
             "line": lines[1] + "\u2028"},
            {"name": "a character outside the usual range",
             "line": "B02\U0001d7cf:"},
        ],
    }

    return {"format": 1, "valid": valid, "invalid": invalid, "typed": typed}


def as_text(vectors: dict) -> str:
    return json.dumps(vectors, indent=1, ensure_ascii=False) + "\n"


def main() -> None:
    vectors = build()
    out = ROOT / "tests" / "vectors" / "sheets_v1.json"
    out.write_text(as_text(vectors), encoding="utf-8")
    print(f"wrote {out.relative_to(ROOT)}: {len(vectors['valid'])} sets, "
          f"{len(vectors['invalid'])} damaged cases")


if __name__ == "__main__":
    main()
