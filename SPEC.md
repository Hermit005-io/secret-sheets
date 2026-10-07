# Sheet format, version 1

This document describes exactly what is on a sheet and how a secret is
recovered from sheets. It is meant to be enough, by itself, to write a new
recovery program if this one is ever lost.

Numbers written `0x..` are hexadecimal. Multi-byte integers are big-endian
(most significant byte first). "Random" always means bytes from the operating
system's cryptographically secure generator.

## 1. Overview

A *set* is the group of sheets made from one secret. Making a set takes four
inputs:

| Input | Limits |
| --- | --- |
| The secret, as text | 1 to 510 bytes when encoded as UTF-8; it must be encodable (no lone surrogates) |
| A label, safe to print | 0 to 64 bytes as UTF-8, on one line (no control characters) |
| `total`, the number of sheets | 2 to 20 |
| `needed`, how many sheets recover the secret | 2 to `total` |

The secret is not split directly. Instead:

1. A random 32-byte key is generated and used once.
2. The secret is padded and encrypted with that key (section 3).
3. The key is split into `total` pieces, any `needed` of which rebuild it
   (section 4).
4. Each sheet carries the encrypted secret and one piece (section 5).

Fewer than `needed` pieces give no information about the key. That is a
property of the mathematics and does not depend on how much computing power
anyone has.

A sheet carries more than its piece, though: the encrypted secret, and a
fingerprint of every piece in the set (section 5.4). Both depend on the key.
So what someone holding too few *sheets* can learn rests on two standard
algorithms, AES-256 and SHA-256, being as strong as they are believed to be.
Finding the key from them means searching 2^256 possibilities.

## 2. What a sheet reveals

Every sheet shows, to anyone who reads it: the label, the date, `needed`,
`total`, which sheet it is, and the size of the secret rounded up to one of
four sizes (section 3.1). Nothing else about the secret can be learned from
fewer than `needed` sheets without breaking AES-256 or SHA-256.

## 3. Encrypting the secret

### 3.1 Padding

The secret's UTF-8 bytes are not changed in any way (no trimming, no Unicode
normalisation). They are prefixed with their length as a 2-byte integer and
followed by zero bytes, up to the smallest of these sizes that fits:

    64, 128, 256, 512 bytes

So a 9-byte secret becomes 64 bytes: `0x00 0x09`, the 9 bytes, then 53 zero
bytes. When unpadding, the length must be at least 1 and fit inside the
padded block, and every byte after the secret must be zero; otherwise the
block is rejected.

### 3.2 Encryption

The padded block is encrypted with AES-256-GCM:

- key: the random 32-byte key,
- nonce: 12 random bytes,
- additional authenticated data: see section 5.3.

The result is the ciphertext followed by the 16-byte tag, so it is 16 bytes
longer than the padded block.

## 4. Splitting the key

### 4.1 The field

Bytes are treated as elements of GF(2^8), the field with 256 elements, in the
representation AES uses: a byte `b7 b6 ... b0` stands for the polynomial
`b7 x^7 + ... + b0`, and arithmetic is done modulo

    x^8 + x^4 + x^3 + x + 1        (0x11B)

Addition and subtraction are both XOR. Multiplication is polynomial
multiplication reduced by 0x11B. For example `0x57 * 0x83 = 0xC1`.

### 4.2 Splitting

Each piece has an `x`: a byte from 1 to 255, different for every piece in the
set. (`x = 0` is never used; that is where the key itself sits.)

For each of the 32 key bytes separately, with `s` the key byte:

1. Take `needed - 1` random bytes `c1, c2, ...`. Every byte value, including
   zero, must be equally likely.
2. The piece with coordinate `x` gets the byte

       y = s + c1*x + c2*x^2 + ... + c(needed-1)*x^(needed-1)

A piece is therefore its `x` and 32 `y` bytes.

How the `x` values are chosen does not matter for security or for recovery.
The Python version uses `x = 1, 2, ..., total` in sheet order. The web version
uses whatever its splitting library chooses.

### 4.3 Rebuilding

Given `needed` pieces with coordinates `x1, ..., xm` (all different), each key
byte is

    s = sum over i of  y_i * w_i,     w_i = product over j != i of  x_j / (x_j + x_i)

with all arithmetic in the field. (This is Lagrange interpolation at zero.)
More than `needed` pieces may be used; the result is the same.

## 5. The sheet

A sheet is a sequence of bytes in two parts. Part A is identical on every
sheet of a set. Part B is that sheet's piece.

### 5.1 Part A: the locked secret

| Bytes | Field | Notes |
| --- | --- | --- |
| 1 | `version` | `0x01` |
| 1 | `needed` | |
| 1 | `total` | |
| 2 | `year` | the date the set was made; 1 to 9999 |
| 1 | `month` | 1 to 12 |
| 1 | `day` | 1 to 31, and a real date in that month and year |
| 1 | `label_length` | 0 to 64 |
| `label_length` | `label` | UTF-8, with no control characters (U+0000 to U+001F, U+007F to U+009F) |
| 12 | `nonce` | |
| 2 | `locked_length` | 80, 144, 272 or 528 |
| `locked_length` | `locked` | ciphertext and tag from section 3.2 |
| 8 x `total` | `fingerprints` | one per sheet, in sheet order (section 5.4) |

### 5.2 Part B: the piece

| Bytes | Field | Notes |
| --- | --- | --- |
| 1 | `number` | which sheet this is, 1 to `total` |
| 1 | `x` | the piece's coordinate, 1 to 255 |
| 32 | `y` | the piece's bytes |

### 5.3 What the encryption authenticates

The additional authenticated data for section 3.2 is these bytes of Part A,
in order: `version`, `needed`, `total`, `year`, `month`, `day`,
`label_length`, `label`, then `fingerprints`. Changing any of them, or the
ciphertext, makes decryption fail.

### 5.4 Fingerprints

The fingerprint of a piece is the first 8 bytes of

    SHA-256( "secret sheet piece v1" || x || y )

where the text is 21 ASCII bytes, `x` is 1 byte and `y` is 32 bytes. Part A
lists the fingerprint of every piece in the set, so any one sheet is enough to
check any other sheet's piece.

Fingerprints are for finding out *which* sheet is wrong. They are not what
stops a forgery: the encryption does that (section 5.3).

### 5.5 Set code

The set code lets people confirm, by reading a few characters aloud, that
they hold sheets from the same set. It is the first 60 bits of

    SHA-256( "secret sheet set v1" || Part A )

written as 12 characters in the alphabet of section 6.1, in three groups of
four, for example `K7QF-2M9X-HT4C`.

## 6. Written forms

### 6.1 Alphabet

Bytes are written five bits at a time, most significant bits first, using
these 32 characters (digit values 0 to 31):

    0 1 2 3 4 5 6 7 8 9 A B C D E F G H J K M N P Q R S T V W X Y Z

The letters I, L, O and U are not used. When reading, lower case is accepted,
`O` is read as `0`, and `I` and `L` are read as `1`. If the number of bits is
not a multiple of five, the last character is filled with zero bits, and a
reader must reject a last character whose filler bits are not zero.

### 6.2 QR code

The QR code on a sheet holds the text

    SSR1:

followed by Part A and Part B, joined and written in the alphabet above with
no separators. Every character is in the QR "alphanumeric" set.

### 6.3 Typed lines

Each part is also printed as lines that can be typed by hand. A line holds up
to 10 bytes of its part:

    A07  7KQ2-M9XH-T4C0-PZ3D  W0

- `A07`: the part (`A` or `B`) and the line number within it, from `01`.
- The data: 10 bytes written as 16 characters. The last line of a part may
  hold fewer bytes and so fewer characters.
- `W0`: a 10-bit check, written as 2 characters.

Spaces and hyphens are only there for the eye and are ignored when reading.
(The example is a real line: its check can be worked out from the rest.)

The check is CRC-10/ATM (polynomial 0x233, initial value 0, no reflection, no
final XOR) computed over: the part letter as one ASCII byte, the line number
as one byte, then the line's data bytes. As a reference point, the CRC of the
nine ASCII bytes `123456789` is `0x199`.

A typing mistake in one line is caught on that line: the check does not match.
Because the part letter and line number are included, a line typed in the
wrong place does not match either.

Part A is the same on every sheet, so a person recovering by hand types it
once, from any sheet, and then only Part B (four lines) from each of the
others.

### 6.4 Reading what a person typed

People copy lines imperfectly, and a reader should forgive what is harmless
and nothing else. These rules are exact, so that every reader accepts and
refuses the same text.

- The text is split into lines at CR LF, CR or LF. Spaces, tabs and a
  byte-order mark (U+FEFF) at either end of a line are ignored.
- A line is a typed line if it starts with `A` or `B` in either case,
  followed by two characters that are digits or the look-alikes `O`, `I`, `L`
  in either case, at least one of them a real digit, and then at least one
  more character. An optional `:` or `.` after those three characters, and
  spaces or tabs around it, are ignored. Every other line is ignored, so
  that the words printed on a sheet can be left in.
- In the rest of the line spaces, tabs and hyphens are ignored. What remains
  is the data characters followed by the two check characters. There must be
  at least three characters and no more than eighteen.
- Only the ASCII digits and letters of section 6.1 are characters, with the
  look-alikes read as that section says. Letters and digits of other
  alphabets are not, even where a programming language would convert them.
- A line number of `00`, a wrong character, a check that does not match, too
  few or too many characters, the same line given twice with different
  contents, a missing line before the last one typed, and a line shorter than
  10 bytes that is not the last of its part are all `bad-line` (section 7).
- A run of characters whose length no whole number of bytes produces (5n
  mod 8 is 5 or more, as with 1, 3 or 6 characters) is refused, like one
  whose filler bits are not zero.
- Text is taken to be QR text if, with spaces, tabs, line breaks and a
  byte-order mark around it ignored, it begins `SSR1:` in either case.
  Nothing may come between its characters, and anything wrong with it is
  `malformed`. All other text is read as typed lines.
- Text in which no typed line is found at all is `malformed`.

## 7. Recovering

Given some sheets:

1. Read each sheet into Part A and Part B. Reject a sheet whose structure
   does not match section 5: an unknown version, `total` outside 2 to 20,
   `needed` outside 2 to `total`, a date that is not real, a label longer
   than 64 bytes, not valid UTF-8 or holding a control character, a
   `locked_length` other than the four allowed, a `number` or `x` of zero,
   or bytes missing or left over.
2. All sheets must have byte-for-byte the same Part A. If they do not, they
   are from different sets, or one has been altered.
3. For each sheet, `number` must be no greater than `total`, and the
   fingerprint of its piece must equal the entry for its `number` in Part A.
4. A sheet presented twice counts once. At least `needed` different sheets
   are required.
5. No two of the sheets may have the same `x`. (A set made properly never
   does; this guards against one that was not.)
6. Rebuild the key (section 4.3), decrypt (section 3.2) and remove the
   padding (section 3.1). The result must be valid UTF-8.

A recovery program must never output a secret unless step 6's decryption
succeeded. If any step fails it reports which one, using these names:

| Name | Meaning |
| --- | --- |
| `bad-line` | a typed line cannot be right (section 6.4) |
| `malformed` | the text holds no sheet, a part of the sheet is missing, the bytes do not have the structure of a sheet (step 1), or two sheets share an `x` (step 5) |
| `unsupported-version` | the sheet says a version this program does not know |
| `mixed-sets` | the sheets do not all have the same Part A (step 2) |
| `wrong-piece` | a piece's `number` is greater than `total`, or the piece does not match its fingerprint (step 3) |
| `too-few` | fewer than `needed` different sheets (step 4) |
| `cannot-unlock` | everything matched, but in step 6 the decryption failed, the padding was wrong, or the result was not UTF-8 |

The first failure met, in the order of the steps, is the one reported.

## 8. Test cases

`tests/vectors/sheets_v1.json` holds complete sets with the secret each must
give back, and damaged sheets with the name of the failure each must produce.
Any program claiming to read version 1 sheets should pass all of them.

`tests/vectors/library_shares.json` holds keys and pieces produced by the
independently audited `shamir-secret-sharing` library (version 0.0.4), used
to check section 4 against a reviewed implementation.
