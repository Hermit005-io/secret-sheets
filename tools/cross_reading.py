"""Check that the Python and web versions read damaged and oddly typed sheets
the same way: the same bytes when they accept, and when they refuse, the same
kind of failure and the same line named.

    cd web && npm install && cd ..
    python tools/cross_reading.py           # 20,000 texts
    python tools/cross_reading.py 100000

Sheets are made, written out in each of their forms, and then mangled the way
copying mangles them, and a good deal worse. Needs Node 22.18 or newer.
"""

import json
import random
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from secretsheets import SheetError, read_parts, split_secret, written  # noqa: E402
from secretsheets.page import sheet_text  # noqa: E402

# What gets typed, pasted or put in by a keyboard that was not asked: spacing,
# look-alikes, other alphabets' letters and digits, and invisible characters.
STRAYS = [*" \t-:.OoIiLl0189ABab\r\n", "\u2028", "\u2029", "\x0b", "\x0c", "\x85", "\ufeff",
          "\u00a0", "\u00df", "\u0131", "\u017f", "\u0660", "\uff10", "\uff2f", "\U0001d7cf",
          "U", "u", "\u00e9", "\x00"]


def mangled(text: str) -> str:
    chars = list(text)
    for _ in range(random.choice([0, 1, 1, 1, 2, 3, 6])):
        kind, at = random.random(), random.randrange(len(chars) + 1)
        if kind < 0.35:
            chars.insert(at, random.choice(STRAYS))
        elif kind < 0.6 and chars:
            chars[min(at, len(chars) - 1)] = random.choice(STRAYS + list(written.ALPHABET))
        elif kind < 0.75 and chars:
            del chars[min(at, len(chars) - 1)]
        elif kind < 0.85 and len(chars) > 1:
            at = min(at, len(chars) - 2)
            chars[at], chars[at + 1] = chars[at + 1], chars[at]
        elif kind < 0.93:
            lines = "".join(chars).split("\n")
            random.shuffle(lines)
            chars = list("\n".join(lines))
        else:
            chars = list("".join(chars).swapcase())
    return "".join(chars)


def some_text() -> str:
    total = random.randint(2, 6)
    sheets = split_secret("s" * random.choice([1, 70, 130]), random.randint(2, total), total,
                          random.choice(["", "Bank", "Cl\u00e9"]))
    sheet = random.choice(sheets)
    part_a = written.typed_lines("A", sheet.locked.to_bytes())
    part_b = written.typed_lines("B", sheet.piece.to_bytes())
    return mangled(random.choice([
        written.qr_text(sheet.to_bytes()),
        sheet_text(sheet, "Kofi", "Ama"),
        "\n".join(part_b),
        "\n".join(part_a + part_b).replace(" ", "").replace("-", ""),
    ]))


def as_python_reads(text: str) -> str:
    try:
        locked, piece = read_parts(text)
    except SheetError as problem:
        return f"refused: {problem.name} {getattr(problem, 'line', '')}".strip()
    return " ".join(part.to_bytes().hex() if part else "-" for part in (locked, piece))


def main() -> int:
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 20_000
    texts = [some_text() for _ in range(count)]
    ours = [as_python_reads(text) for text in texts]
    read = subprocess.run(["node", "scripts/read_texts.ts"], cwd=ROOT / "web", text=True,
                          input=json.dumps(texts), capture_output=True, encoding="utf-8",
                          check=True)
    theirs = json.loads(read.stdout)

    different = [(text, a, b) for text, a, b in zip(texts, ours, theirs, strict=True) if a != b]
    for text, a, b in different[:5]:
        print(f"  {text!r}\n    Python: {a[:60]}\n    web:    {b[:60]}")
    accepted = sum(1 for answer in ours if not answer.startswith("refused"))
    print(f"{count} mangled texts: {accepted} read, {count - accepted} refused, "
          f"and the two versions differ on {len(different)}")
    return 1 if different else 0


if __name__ == "__main__":
    sys.exit(main())
