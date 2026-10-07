"""The written forms of a sheet: the text inside the QR code, and the lines a
person can type by hand. See SPEC.md, section 6.

A typed line looks like

    A07  7KQ2-M9XH-T4C0-PZ3D  W0

part and line number, ten bytes of data, and a check. The check is a CRC, a
kind of checksum with a useful guarantee: it always catches a run of damaged
bits no longer than itself. One mistyped character damages five bits in a row
and two neighbouring characters swapped damage at most ten, so both are
always caught, on the line where they happened.

Reading is forgiving about how a person types (capitals or not, the letter O
for zero, spacing, dashes) and about nothing else. Only the characters listed
here are ever accepted: Python's own idea of upper case or of a digit takes in
letters and numerals from other alphabets, which a sheet never contains.
"""

import re

from .errors import BadLine, Malformed

# 32 characters, leaving out I, L, O and U (easily confused with 1, 1, 0, V).
ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
# What people type when they misread: letter O for zero, I or L for one.
LOOKALIKES = {"O": "0", "I": "1", "L": "1"}
_VALUES = {char: value for value, char in enumerate(ALPHABET)}
_VALUES.update({wrong: _VALUES[right] for wrong, right in LOOKALIKES.items()})
_VALUES.update({char.lower(): value for char, value in list(_VALUES.items())})

QR_PREFIX = "SSR1:"
BYTES_PER_LINE = 10
CHARACTERS_PER_LINE = 16     # ten bytes, five bits to a character
CRC_POLYNOMIAL = 0x233   # CRC-10/ATM: x^10 + x^9 + x^5 + x^4 + x + 1

# Ignored around a sheet's text and at either end of a line.
EDGES = " \t\r\n\ufeff"
# Ignored between the characters of a typed line.
_SPACING = str.maketrans("", "", " \t-")
# A typed line: part letter, two digits (or their look-alikes), then the rest.
_LINE = re.compile(r"^([ABab])([0-9OoIiLl]{2})[ \t]*[:.]?[ \t]*(.+)$")
_DIGITS = str.maketrans("OoIiLl", "001111")


def to_text(data: bytes) -> str:
    """Bytes as characters, five bits each, padded with zero bits at the end."""
    bits = int.from_bytes(data, "big") << (-8 * len(data) % 5)
    count = (8 * len(data) + 4) // 5
    return "".join(ALPHABET[(bits >> 5 * (count - 1 - i)) & 31] for i in range(count))


def from_text(text: str) -> bytes:
    """The reverse of to_text. Raises ValueError for a character outside the
    alphabet, a length no number of bytes could produce, or non-zero padding."""
    if 5 * len(text) % 8 >= 5:
        raise ValueError("an impossible number of characters")
    data = bytearray()
    buffer = bits = 0
    for char in text:
        if char not in _VALUES:
            raise ValueError("a character that is never used on a sheet")
        buffer = buffer << 5 | _VALUES[char]
        bits += 5
        if bits >= 8:
            bits -= 8
            data.append(buffer >> bits)
            buffer &= (1 << bits) - 1
    if buffer:
        raise ValueError("the last character is not one a sheet could end with")
    return bytes(data)


def crc10(data: bytes) -> int:
    crc = 0
    for byte in data:
        crc ^= byte << 2
        for _ in range(8):
            crc <<= 1
            if crc & 0x400:
                crc ^= 0x400 | CRC_POLYNOMIAL
    return crc


def _check(part: str, number: int, data: bytes) -> str:
    crc = crc10(part.encode("ascii") + bytes([number]) + data)
    return ALPHABET[crc >> 5] + ALPHABET[crc & 31]


def is_qr_text(text: str) -> bool:
    """Whether `text` starts the way a sheet's QR code does."""
    start = text.strip(EDGES)[:len(QR_PREFIX)]
    return start.isascii() and start.upper() == QR_PREFIX


# ---- the QR code -------------------------------------------------------------------
def qr_text(sheet_bytes: bytes) -> str:
    return QR_PREFIX + to_text(sheet_bytes)


def from_qr_text(text: str) -> bytes:
    if not is_qr_text(text):
        raise Malformed("This is not the text from a sheet's QR code.")
    try:
        return from_text(text.strip(EDGES)[len(QR_PREFIX):])
    except ValueError as problem:
        raise Malformed(f"The QR code's text is damaged: {problem}.") from None


# ---- typed lines -------------------------------------------------------------------
def typed_lines(part: str, data: bytes) -> list[str]:
    """`data` as the lines printed on a sheet for part 'A' or 'B'."""
    lines = []
    for start in range(0, len(data), BYTES_PER_LINE):
        number = start // BYTES_PER_LINE + 1
        chunk = data[start:start + BYTES_PER_LINE]
        text = to_text(chunk)
        groups = "-".join(text[i:i + 4] for i in range(0, len(text), 4))
        lines.append(f"{part}{number:02d}  {groups}  {_check(part, number, chunk)}")
    return lines


def _as_typed_line(line: str) -> re.Match | None:
    """The pieces of `line` if it starts like a typed line: A or B, then two
    digits. Look-alikes may stand for the digits, but not for both of them,
    or words such as "All" would be taken for lines."""
    found = _LINE.match(line.strip(EDGES))
    return found if found and re.search("[0-9]", found.group(2)) else None


def starts_like_a_line(text: str) -> bool:
    """Whether any line of `text` would be read as a typed line of a sheet."""
    return any(_as_typed_line(line) for line in re.split(r"\r\n|\r|\n", text))


def read_typed_lines(text: str) -> dict[str, bytes]:
    """Pick the typed lines out of `text` (a whole sheet, instructions and
    all) and return the bytes of each part found: {'A': ..., 'B': ...}.

    Anything that doesn't start like a typed line is ignored. A line that
    does, but fails its check, raises BadLine naming the line."""
    chunks: dict[str, dict[int, bytes]] = {}
    for line in re.split(r"\r\n|\r|\n", text):
        found = _as_typed_line(line)
        if not found:
            continue
        part, number = found.group(1).upper(), int(found.group(2).translate(_DIGITS))
        label = f"{part}{number:02d}"
        mistake = BadLine(f"Line {label} has a mistake in it. Please check it against the "
                          "sheet.", label)

        body = found.group(3).translate(_SPACING)
        if number == 0 or len(body) < 3:
            raise BadLine(f"Line {label} is incomplete.", label)
        if len(body) > CHARACTERS_PER_LINE + 2:
            raise mistake
        try:
            chunk = from_text(body[:-2])
        except ValueError:
            raise mistake from None
        typed_check = "".join(ALPHABET[_VALUES[char]] if char in _VALUES else "?"
                              for char in body[-2:])
        if typed_check != _check(part, number, chunk):
            raise mistake
        if chunks.setdefault(part, {}).setdefault(number, chunk) != chunk:
            raise BadLine(f"Line {label} appears twice, with different contents.")

    parts = {}
    for part, by_number in sorted(chunks.items()):
        count = max(by_number)
        for number in range(1, count + 1):
            if number not in by_number:
                label = f"{part}{number:02d}"
                raise BadLine(f"Line {label} is missing.", label)
        for number in range(1, count):
            if len(by_number[number]) != BYTES_PER_LINE:
                label = f"{part}{number:02d}"
                raise BadLine(f"Line {label} is shorter than it should be.", label)
        parts[part] = b"".join(by_number[n] for n in range(1, count + 1))
    return parts
