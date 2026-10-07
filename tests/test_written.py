import itertools
import random

import pytest
from hypothesis import given
from hypothesis import strategies as st

from secretsheets import written
from secretsheets.errors import BadLine, Malformed
from secretsheets.written import ALPHABET


# ---- bytes as characters ---------------------------------------------------------------
@given(st.binary(max_size=200))
def test_text_round_trip(data):
    text = written.to_text(data)
    assert set(text) <= set(ALPHABET)
    assert len(text) == -(-8 * len(data) // 5)       # 5 bits a character, rounded up
    assert written.from_text(text) == data


def test_text_examples():
    assert written.to_text(b"") == ""
    assert written.to_text(b"\x00") == "00"
    assert written.to_text(b"\xff") == "ZW"             # 11111 111(00)
    assert written.to_text(b"hello") == "D1JPRV3F"


def test_common_misreadings_are_accepted():
    assert written.from_text("d1jprv3f") == b"hello"
    assert written.from_text("DIJPRV3F") == b"hello"     # I for 1
    assert written.from_text("DLJPRV3F") == b"hello"     # L for 1
    assert written.from_text("OO") == b"\x00"            # O for 0


@pytest.mark.parametrize("text", ["U0", "0!", "0", "000", "000000", "ZZ", "01"])
def test_text_no_bytes_could_have_produced_is_refused(text):
    # U is never used; 1, 3 and 6 characters are impossible lengths; and the
    # spare bits in the last character must be zero.
    with pytest.raises(ValueError):
        written.from_text(text)


@pytest.mark.parametrize("text", ["ß0", "ı0", "ſ0", "٠0", "０0", "Ｏ0"])
def test_only_plain_letters_and_digits_stand_in_for_each_other(text):
    # Python would upper-case ß to SS and ı to I, and read ٠ and ０ as digits.
    # None of them is on a sheet, so none of them is accepted.
    with pytest.raises(ValueError):
        written.from_text(text)


def test_crc_matches_the_published_check_value():
    assert written.crc10(b"123456789") == 0x199


# ---- typed lines -----------------------------------------------------------------------
@given(st.sampled_from("AB"), st.binary(min_size=1, max_size=120))
def test_typed_lines_round_trip(part, data):
    lines = written.typed_lines(part, data)
    assert len(lines) == -(-len(data) // 10)
    assert written.read_typed_lines("\n".join(lines)) == {part: data}


def test_a_line_looks_like_the_one_in_the_specification():
    line = written.typed_lines("A", bytes(range(10)))[0]
    assert line == "A01  000G-40R4-0M30-E209  Y0"


def test_lines_are_found_among_other_text_however_they_are_spaced():
    a, b = bytes(range(25)), bytes(range(100, 134))
    sheet = "\n".join(["SECRET SHEET 2 OF 5", "", "PART A   the locked secret",
                       *written.typed_lines("A", a), "", "PART B   this sheet's piece",
                       *written.typed_lines("B", b), "A note at the end."])
    assert written.read_typed_lines(sheet) == {"A": a, "B": b}

    untidy = sheet.lower().replace("-", " ").replace("a01  ", "   A01: ")
    assert written.read_typed_lines(untidy) == {"A": a, "B": b}
    assert written.read_typed_lines("Nothing typed here.\nA1 is a road.") == {}


def test_the_ways_people_really_type_a_line():
    data = bytes(range(100, 134))
    lines = written.typed_lines("B", data)
    assert lines[1].startswith("B02  ")
    for typed in [
        lines[1].replace(" ", "").replace("-", ""),         # no spaces or dashes at all
        lines[1].replace("B02  ", "B02:"),                  # a colon and no space
        lines[1].replace("B02", "BO2"),                     # letter O in the line number
        lines[1].replace("B02", "b o2".replace(" ", "")),
        "\t " + lines[1] + " \t",
    ]:
        text = "\n".join([lines[0], typed, lines[2], lines[3]])
        assert written.read_typed_lines(text) == {"B": data}, typed
    assert written.read_typed_lines("\n".join(lines).replace("B01", "B0l")) == {"B": data}
    # With no digit left at all it is taken for a word, and the line is missed by name.
    with pytest.raises(BadLine, match="B01 is missing"):
        written.read_typed_lines("\n".join(lines).replace("B01", "BOl"))

    # Any of the three kinds of line ending, and the invisible mark some
    # editors put at the start of a file.
    for ending in ("\n", "\r\n", "\r"):
        assert written.read_typed_lines("\ufeff" + ending.join(lines)) == {"B": data}


def test_words_that_merely_begin_like_a_line_are_left_alone():
    text = "All of them.\nBill has one.\nA٠١ 0000\nBoo\nA01"
    assert written.read_typed_lines(text) == {}


def test_telling_whether_words_would_be_read_as_a_line():
    for text in ["B12 Vitamins", "a07: x", "  A0l.x", "notes\nB04 0"]:
        assert written.starts_like_a_line(text), text
    for text in ["", "B12", "Bill has one", "A1 is a road", "Vitamin B12 Ltd", "All 0000"]:
        assert not written.starts_like_a_line(text), text


def test_only_real_line_breaks_end_a_line():
    # U+2028 and U+2029 are "line separators" to some programs. Here they are
    # just characters that no sheet contains.
    lines = written.typed_lines("B", bytes(range(34)))
    for separator in ("\u2028", "\u2029", "\x0b", "\x0c", "\x85"):
        with pytest.raises(BadLine, match="B01"):
            written.read_typed_lines(separator.join(lines))


def test_a_very_long_line_is_refused_at_once():
    with pytest.raises(BadLine, match="A01"):
        written.read_typed_lines("A01 " + "0" * 400_000)
    assert written.read_typed_lines("A01" + " " * 400_000) == {}


def body_of(line: str) -> tuple[str, str]:
    """A line as its label and its characters with the spacing removed."""
    return line[:3], line[3:].replace(" ", "").replace("-", "")


def refused(label: str, body: str) -> bool:
    try:
        written.read_typed_lines(f"{label} {body}")
    except BadLine as problem:
        return label in str(problem)
    return False


# A line of every length there can be, in each part. The data is random but
# the same on every run.
_random = random.Random(1979)
LINES_OF_EVERY_LENGTH = [
    written.typed_lines(part, bytes(10) + _random.randbytes(length))[1]
    for part in "AB" for length in range(1, 11)
]


@pytest.mark.parametrize("line", LINES_OF_EVERY_LENGTH)
def test_every_single_wrong_character_is_caught_on_its_line(line):
    # Every position, the two check characters included, changed to each of
    # the 31 other characters.
    label, body = body_of(line)
    for position, right in enumerate(body):
        for wrong in ALPHABET:
            if wrong != right:
                assert refused(label, body[:position] + wrong + body[position + 1:])


@pytest.mark.parametrize("line", LINES_OF_EVERY_LENGTH)
def test_every_swap_of_two_neighbouring_characters_is_caught(line):
    label, body = body_of(line)
    for position in range(len(body) - 1):
        left, right = body[position], body[position + 1]
        if left != right:
            assert refused(label, body[:position] + right + left + body[position + 2:])


@pytest.mark.parametrize("length", range(1, 11))
def test_every_pair_of_characters_swapped_is_caught(length):
    # The same, but with every possible pair of different characters put at
    # every pair of neighbouring places in the data, and the check worked out
    # afresh, so that no pair is left to chance.
    count = len(written.to_text(bytes(length)))
    for position, (left, right) in itertools.product(
            range(count - 1), itertools.permutations(ALPHABET, 2)):
        text = "0" * position + left + right + "0" * (count - position - 2)
        try:
            data = written.from_text(text)
        except ValueError:
            continue        # not a line a sheet could have: its filler bits are not zero
        label, body = body_of(written.typed_lines("B", bytes(10) + data)[1])
        assert body.startswith(text)
        assert refused(label, body[:position] + right + left + body[position + 2:])


def test_a_wrong_part_letter_or_line_number_is_caught():
    for line in LINES_OF_EVERY_LENGTH:
        label, body = body_of(line)
        other = "B" if label[0] == "A" else "A"
        assert refused(other + label[1:], body)
        for number in range(1, 100):
            if number != 2:
                assert refused(f"{label[0]}{number:02d}", body)


def test_a_line_in_the_wrong_place_is_caught():
    lines = written.typed_lines("B", bytes(range(34)))
    for wrong_label in ("B01", "B03", "A02"):
        with pytest.raises(BadLine, match=wrong_label):
            written.read_typed_lines(wrong_label + lines[1][3:])


def test_missing_short_and_contradictory_lines():
    lines = written.typed_lines("B", bytes(range(34)))
    with pytest.raises(BadLine, match="B02 is missing"):
        written.read_typed_lines("\n".join([lines[0], lines[2], lines[3]]))
    with pytest.raises(BadLine, match="B01 is missing"):
        written.read_typed_lines(lines[1])

    # A short line is only allowed at the end of a part.
    short_then_more = written.typed_lines("B", bytes(4)) + [written.typed_lines("B", bytes(20))[1]]
    with pytest.raises(BadLine, match="B01 is shorter"):
        written.read_typed_lines("\n".join(short_then_more))

    other = written.typed_lines("B", bytes(range(1, 35)))
    with pytest.raises(BadLine, match="B01 appears twice"):
        written.read_typed_lines("\n".join([lines[0], other[0]]))
    # The same line twice is harmless.
    assert written.read_typed_lines("\n".join([lines[0], *lines])) == {"B": bytes(range(34))}

    with pytest.raises(BadLine, match="B01 is incomplete"):
        written.read_typed_lines("B01  0")
    with pytest.raises(BadLine):
        written.read_typed_lines("B00  0000")


# ---- the QR code's text -------------------------------------------------------------------
@given(st.binary(min_size=1, max_size=300))
def test_qr_text_round_trip(data):
    text = written.qr_text(data)
    assert text.startswith("SSR1:")
    # Only characters a QR code can store in its compact "alphanumeric" mode.
    assert set(text) <= set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:")
    assert written.from_qr_text(f"  {text.lower()}\n") == data


@pytest.mark.parametrize("text", ["", "https://example.com", "SSR2:0000", "SSR1:U", "SSR1:000"])
def test_text_that_is_not_from_a_sheet(text):
    with pytest.raises(Malformed):
        written.from_qr_text(text)
