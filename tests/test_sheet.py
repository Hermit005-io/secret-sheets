import contextlib
import datetime

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from secretsheets import split_secret
from secretsheets.errors import Malformed, SheetError, UnsupportedVersion
from secretsheets.sheet import Locked, Piece, Sheet

DAY = datetime.date(2026, 10, 7)
SHEETS = split_secret("correct horse battery staple", 3, 5, "Email recovery codes", made_on=DAY)


def test_bytes_round_trip():
    for sheet in SHEETS:
        assert Sheet.from_bytes(sheet.to_bytes()) == sheet
    locked = SHEETS[0].locked
    assert Locked.from_bytes(locked.to_bytes()) == locked
    assert Piece.from_bytes(SHEETS[2].piece.to_bytes()) == SHEETS[2].piece


def test_layout_matches_the_specification():
    data = SHEETS[1].to_bytes()
    label = b"Email recovery codes"
    assert data[:8] == bytes([1, 3, 5, 0x07, 0xEA, 10, 7, len(label)])     # 0x07EA = 2026
    assert data[8:28] == label
    assert data[40:42] == (80).to_bytes(2, "big")       # a 64-byte block and a 16-byte tag
    assert len(data) == 28 + 12 + 2 + 80 + 5 * 8 + 34
    assert data[-34:-32] == bytes([2, 2])               # sheet 2, coordinate 2
    assert SHEETS[1].locked.fingerprints[1] == SHEETS[1].piece.fingerprint()


@pytest.mark.parametrize("length, locked_size", [(1, 80), (62, 80), (63, 144), (126, 144),
                                                 (127, 272), (254, 272), (255, 528), (510, 528)])
def test_the_locked_secret_comes_in_four_sizes(length, locked_size):
    sheet = split_secret("s" * length, 2, 2)[0]
    assert len(sheet.locked.locked) == locked_size


def test_every_sheet_of_a_set_shares_part_a_and_a_set_code():
    assert len({sheet.locked for sheet in SHEETS}) == 1
    code = SHEETS[0].locked.set_code()
    assert len(code) == 14 and code[4] == code[9] == "-"
    other = split_secret("correct horse battery staple", 3, 5, "Email recovery codes",
                         made_on=DAY)
    assert other[0].locked.set_code() != code            # a new set every time


def test_a_sheet_knows_whether_its_piece_is_intact():
    assert all(sheet.piece_is_intact() for sheet in SHEETS)
    # Sheet 2's piece with a 1 written on it.
    strayed = Sheet(SHEETS[0].locked, Piece(1, 2, SHEETS[1].piece.y))
    assert not strayed.piece_is_intact()
    beyond = Sheet(SHEETS[0].locked, Piece(6, 6, bytes(32)))
    assert not beyond.piece_is_intact()


# ---- bytes that are not a sheet ----------------------------------------------------------
def test_a_sheet_cut_short_anywhere_is_refused():
    data = SHEETS[0].to_bytes()
    for length in range(len(data)):
        with pytest.raises(Malformed):
            Sheet.from_bytes(data[:length])
    with pytest.raises(Malformed):
        Sheet.from_bytes(data + b"\x00")


def changed(position: int, value: int) -> bytes:
    data = bytearray(SHEETS[0].to_bytes())
    data[position] = value
    return bytes(data)


@pytest.mark.parametrize("position, value, complaint", [
    (1, 1, "numbers"),          # needed = 1
    (1, 6, "numbers"),          # needed > total
    (2, 21, "numbers"),         # total too large
    (5, 13, "date"),            # month 13
    (6, 0, "date"),             # day 0
    (7, 65, "label"),           # label longer than allowed
    (41, 81, "size"),           # locked secret of an impossible length
    (-34, 0, "piece"),          # sheet number 0
    (-33, 0, "piece"),          # coordinate 0
])
def test_impossible_details_are_refused(position, value, complaint):
    with pytest.raises(Malformed, match=complaint):
        Sheet.from_bytes(changed(position, value))


def test_a_label_that_is_not_text_is_refused():
    with pytest.raises(Malformed, match="label"):
        Sheet.from_bytes(changed(8, 0xFF))
    # Nor one holding a line break or another control character, which could
    # pass itself off as more lines of the sheet when printed.
    for control in (0x00, 0x0A, 0x1B, 0x7F):
        with pytest.raises(Malformed, match="label"):
            Sheet.from_bytes(changed(8, control))


def test_another_format_version_is_named_as_such():
    for version in (0, 2, 255):
        with pytest.raises(UnsupportedVersion, match=f"version {version}"):
            Sheet.from_bytes(changed(0, version))


@given(st.binary(max_size=400))
@settings(max_examples=300)
def test_arbitrary_bytes_never_cause_anything_but_a_plain_refusal(data):
    with contextlib.suppress(SheetError):
        Sheet.from_bytes(data)


@given(st.lists(st.tuples(st.integers(0, 195), st.integers(0, 255)), max_size=6),
       st.integers(0, 196))
@settings(max_examples=1000)
def test_a_scribbled_on_sheet_never_causes_anything_but_a_plain_refusal(edits, keep):
    # Random bytes rarely look enough like a sheet to get far. A real sheet
    # with a few bytes overwritten and the end cut off gets much further in.
    data = bytearray(SHEETS[0].to_bytes())
    for position, value in edits:
        data[position] = value
    with contextlib.suppress(SheetError):
        Sheet.from_bytes(bytes(data[:keep or None]))
