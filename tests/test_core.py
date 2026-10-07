import datetime
import json
import secrets
import sys
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from secretsheets import (
    SheetError,
    check_sheet,
    locking,
    read_parts,
    read_sheet,
    recover_secret,
    split_secret,
    written,
)
from secretsheets.errors import CannotUnlock, Malformed, MixedSets, TooFew, WrongPiece
from secretsheets.sheet import Locked, Piece, Sheet

ROOT = Path(__file__).parent.parent
VECTORS = json.loads((ROOT / "tests" / "vectors" / "sheets_v1.json").read_text(encoding="utf-8"))

SECRET = "correct horse battery staple"
MADE_ON = datetime.date(2026, 3, 14)
SHEETS = split_secret(SECRET, 3, 5, "Email recovery codes", made_on=MADE_ON)


# ---- splitting and recovering --------------------------------------------------------
@st.composite
def a_set(draw):
    secret = draw(st.text(min_size=1, max_size=120).filter(
        lambda text: len(text.encode("utf-8")) <= locking.MAX_SECRET_BYTES))
    total = draw(st.integers(2, 20))
    needed = draw(st.integers(2, total))
    used = draw(st.lists(st.sampled_from(range(total)), min_size=needed, unique=True))
    return secret, needed, total, used


@given(a_set())
@settings(max_examples=150, deadline=None)
def test_any_selection_of_enough_sheets_recovers_the_secret(case):
    secret, needed, total, used = case
    sheets = split_secret(secret, needed, total)
    assert len(sheets) == total
    assert recover_secret([sheets[i] for i in used]) == secret


def test_the_secret_comes_back_exactly_as_typed():
    for secret in ["  spaces at both ends  ", "tab\tand\nnew line", "pässwörd ключ 密碼 🔑",
                   "é and é are different bytes"]:
        assert recover_secret(split_secret(secret, 2, 3)[1:]) == secret


def test_order_and_repeats_do_not_matter():
    a, b, c, d, e = SHEETS
    assert recover_secret([e, a, c]) == SECRET
    assert recover_secret([b, b, d, a, d]) == SECRET
    assert recover_secret(SHEETS) == SECRET


def test_two_sets_from_one_secret_have_nothing_in_common():
    again = split_secret(SECRET, 3, 5, "Email recovery codes")
    assert again[0].locked.locked != SHEETS[0].locked.locked
    assert again[0].piece.y != SHEETS[0].piece.y


def test_random_bytes_are_asked_for_in_a_fixed_order():
    asked = []

    def source(count: int) -> bytes:
        asked.append(count)
        return secrets.token_bytes(count)

    split_secret("secret", 4, 6, random_bytes=source)
    assert asked == [32, 12, 3 * 32]      # the key, the nonce, the coefficients


@pytest.mark.parametrize("secret, needed, total, label, complaint", [
    ("", 2, 3, "", "no secret"),
    ("x" * 511, 2, 3, "", "too long"),
    ("é" * 256, 2, 3, "", "too long"),          # 512 bytes, though only 256 characters
    ("secret", 2, 3, "x" * 65, "label"),
    ("secret", 1, 3, "", "at least 2"),
    ("secret", 4, 3, "", "no more than"),
    ("secret", 2, 1, "", "number of sheets"),
    ("secret", 2, 21, "", "number of sheets"),
    ("half a \ud83d character", 2, 3, "", "cannot be stored"),
    ("secret", 2, 3, "half a \ud83d character", "cannot be stored"),
    ("secret", 2, 3, "two\nlines", "one line"),
    ("secret", 2, 3, "a\ttab", "one line"),
])
def test_impossible_requests_are_refused_in_plain_words(secret, needed, total, label, complaint):
    with pytest.raises(ValueError, match=complaint):
        split_secret(secret, needed, total, label)


# ---- when something is wrong -------------------------------------------------------------
def test_too_few_sheets():
    with pytest.raises(TooFew, match="3 different sheets are needed, and so far there are 2"):
        recover_secret(SHEETS[:2])
    with pytest.raises(TooFew, match="there is 1"):
        recover_secret([SHEETS[0], SHEETS[0]])
    with pytest.raises(TooFew):
        recover_secret([])


def test_a_sheet_from_another_set_is_named():
    other = split_secret("something else", 3, 5, "Email recovery codes")
    with pytest.raises(MixedSets, match="Sheet 4 does not belong"):
        recover_secret([SHEETS[0], SHEETS[1], other[3]])
    with pytest.raises(MixedSets, match="Sheets 2, 4 do not belong"):
        recover_secret([SHEETS[0], other[1], SHEETS[2], other[3], SHEETS[4]])
    # One sheet from each: no telling which is the odd one, so both codes are given.
    with pytest.raises(MixedSets) as failure:
        recover_secret([SHEETS[0], other[1]])
    assert SHEETS[0].locked.set_code() in str(failure.value)
    assert other[0].locked.set_code() in str(failure.value)


def test_a_damaged_piece_is_named():
    piece = SHEETS[3].piece
    damaged = Sheet(SHEETS[3].locked, Piece(piece.number, piece.x, bytes(32)))
    with pytest.raises(WrongPiece, match="Sheet 4"):
        recover_secret([SHEETS[0], SHEETS[1], damaged])
    with pytest.raises(WrongPiece, match="only 5 sheets"):
        recover_secret([SHEETS[0], SHEETS[1], Sheet(SHEETS[0].locked, Piece(9, 9, piece.y))])


def test_two_sheets_at_the_same_coordinate_are_refused_not_crashed_on():
    # Only a set that was built wrongly, or on purpose, can look like this.
    old, first, second = SHEETS[0].locked, SHEETS[0].piece, SHEETS[1].piece
    twin = Piece(second.number, first.x, second.y)
    prints = (old.fingerprints[0], twin.fingerprint(), *old.fingerprints[2:])
    forged = Locked(old.needed, old.total, old.made_on, old.label, old.nonce, old.locked, prints)
    with pytest.raises(Malformed, match="same piece under different numbers"):
        recover_secret([Sheet(forged, first), Sheet(forged, twin), Sheet(forged, SHEETS[2].piece)])


def flipped(data: bytes, bit: int) -> bytes:
    changed = bytearray(data)
    changed[bit // 8] ^= 1 << (bit % 8)
    return bytes(changed)


def outcome(sheet_bytes: list[bytes]) -> str:
    """Try a recovery from raw sheets. The name of the refusal, or the secret."""
    try:
        return recover_secret([Sheet.from_bytes(data) for data in sheet_bytes])
    except SheetError as refusal:
        return refusal.name


def test_no_single_flipped_bit_on_one_sheet_ever_gives_a_wrong_secret():
    # Every bit of a sheet in turn, with two good sheets beside it. The only
    # acceptable outcomes are a refusal or (never, here) the right secret.
    good = [sheet.to_bytes() for sheet in SHEETS[:2]]
    target = SHEETS[2].to_bytes()
    refusals = set()
    for bit in range(8 * len(target)):
        result = outcome([*good, flipped(target, bit)])
        assert result != SECRET and result in {"mixed-sets", "wrong-piece", "malformed",
                                               "unsupported-version"}, (bit, result)
        refusals.add(result)
    assert refusals == {"mixed-sets", "wrong-piece", "malformed", "unsupported-version"}


def test_no_flipped_bit_copied_onto_every_sheet_ever_gives_a_wrong_secret():
    # Harder: the same change made to Part A of all three sheets, so they
    # still agree with each other. Now only the encryption can notice.
    part_a = len(SHEETS[0].locked.to_bytes())
    refusals = set()
    for bit in range(8 * part_a):
        result = outcome([flipped(sheet.to_bytes(), bit) for sheet in SHEETS[:3]])
        assert result != SECRET and result in {"cannot-unlock", "wrong-piece", "malformed",
                                               "unsupported-version", "too-few"}, (bit, result)
        refusals.add(result)
    assert "cannot-unlock" in refusals


def test_changing_the_label_or_date_on_every_sheet_is_caught():
    old = SHEETS[0].locked
    for label, day in [("Bank", old.made_on), (old.label, datetime.date(2020, 1, 1))]:
        forged = Locked(old.needed, old.total, day, label, old.nonce, old.locked,
                        old.fingerprints)
        with pytest.raises(CannotUnlock):
            recover_secret([Sheet(forged, sheet.piece) for sheet in SHEETS[:3]])


# ---- reading sheets from text -----------------------------------------------------------
def test_reading_the_qr_text_and_the_typed_lines_gives_the_same_sheet():
    sheet = SHEETS[1]
    typed = "\n".join(written.typed_lines("A", sheet.locked.to_bytes())
                      + written.typed_lines("B", sheet.piece.to_bytes()))
    assert read_sheet(written.qr_text(sheet.to_bytes())) == sheet
    assert read_sheet(typed) == sheet


def test_part_a_typed_once_and_part_b_from_each_other_sheet():
    first = read_sheet(written.qr_text(SHEETS[0].to_bytes()))
    others = []
    for sheet in SHEETS[2:4]:
        locked, piece = read_parts("\n".join(written.typed_lines("B", sheet.piece.to_bytes())))
        assert locked is None
        others.append(piece)
    assert recover_secret([first], extra_pieces=others) == SECRET

    stranger = split_secret("something else", 3, 5)[1].piece
    with pytest.raises(WrongPiece, match="Sheet 2"):
        recover_secret([first], extra_pieces=[others[0], stranger])


def test_a_sheet_with_a_part_missing_says_which():
    only_b = "\n".join(written.typed_lines("B", SHEETS[0].piece.to_bytes()))
    with pytest.raises(Malformed, match="Part A"):
        read_sheet(only_b)
    only_a = "\n".join(written.typed_lines("A", SHEETS[0].locked.to_bytes()))
    with pytest.raises(Malformed, match="Part B"):
        read_sheet(only_a)


def test_text_with_no_sheet_in_it_says_so():
    for text in ["", "   \n", "hello", "A1 is a road.\nAll of it."]:
        with pytest.raises(Malformed, match="No sheet was found"):
            read_parts(text)


def test_a_sheet_made_today_carries_todays_date():
    before = datetime.date.today()
    made_on = split_secret("s", 2, 2)[0].locked.made_on
    assert before <= made_on <= datetime.date.today()


def test_a_piece_numbered_outside_the_set_is_refused():
    locked, piece = SHEETS[4].locked, SHEETS[4].piece
    # Sheet "0" must not be read as the last sheet, counting from the end.
    for number in (0, 6):
        stray = Sheet(locked, Piece(number, piece.x, piece.y))
        assert not stray.piece_is_intact()
        with pytest.raises(WrongPiece):
            recover_secret([SHEETS[0], SHEETS[1], stray])


def test_new_sheets_are_read_back_before_they_are_handed_over(monkeypatch):
    # If what is written out could not be read back, nothing is returned.
    monkeypatch.setattr(written, "qr_text", lambda data: "SSR1:" + written.to_text(data[:-1]))
    with pytest.raises(RuntimeError, match="recovery check"):
        split_secret(SECRET, 2, 3)


def test_checking_a_sheet_reveals_its_details_and_nothing_else():
    report = check_sheet(SHEETS[2])
    assert report.intact and (report.number, report.needed, report.total) == (3, 3, 5)
    assert report.label == "Email recovery codes"
    assert report.set_code == SHEETS[0].locked.set_code()
    assert report.made_on == MADE_ON

    piece = SHEETS[2].piece
    assert not check_sheet(Sheet(SHEETS[2].locked, Piece(3, piece.x, bytes(32)))).intact


# ---- padding and locking ---------------------------------------------------------------
@pytest.mark.parametrize("length, size", [(1, 64), (62, 64), (63, 128), (510, 512)])
def test_padding_sizes(length, size):
    block = locking.pad(b"s" * length)
    assert len(block) == size
    assert locking.unpad(block) == b"s" * length


@pytest.mark.parametrize("block", [
    bytes(64),                                      # says the secret is empty
    b"\x00\x05hello" + b"\x00" * 56 + b"\x01",      # something after the secret
    b"\x00\x05hello" + b"\x00" * 50,                # not one of the four sizes
    b"\x00\x7f" + b"x" * 62,                        # claims more than the block holds
])
def test_blocks_that_are_not_padded_secrets(block):
    with pytest.raises(ValueError):
        locking.unpad(block)


def test_unlocking_needs_the_same_key_and_the_same_details():
    key, nonce = secrets.token_bytes(32), secrets.token_bytes(12)
    locked = locking.lock(key, nonce, b"secret", b"details")
    assert locking.unlock(key, nonce, locked, b"details") == b"secret"
    with pytest.raises(ValueError):
        locking.unlock(secrets.token_bytes(32), nonce, locked, b"details")
    with pytest.raises(ValueError):
        locking.unlock(key, nonce, locked, b"other details")
    with pytest.raises(ValueError):
        locking.unlock(key, nonce, flipped(locked, 3), b"details")


# ---- the published test cases --------------------------------------------------------------
@pytest.mark.parametrize("case", VECTORS["valid"], ids=lambda case: case["name"])
def test_published_sets_give_back_their_secret(case):
    sheets = [read_sheet(text) for text in case["sheets"]]
    needed = case["needed"]
    assert sheets[0].locked.set_code() == case["set_code"]
    assert recover_secret(sheets[:needed]) == case["secret"]
    assert recover_secret(sheets[-needed:]) == case["secret"]
    assert recover_secret(sheets) == case["secret"]


@pytest.mark.parametrize("case", VECTORS["invalid"], ids=lambda case: case["name"])
def test_published_damaged_sheets_are_refused_for_the_stated_reason(case):
    with pytest.raises(SheetError) as refusal:
        recover_secret([read_sheet(text) for text in case["sheets"]])
    assert refusal.value.name == case["expect"]


def test_published_typed_lines():
    typed = VECTORS["typed"]
    first = read_sheet("\n".join(typed["part_a"] + typed["part_b"][0]))
    pieces = [read_parts("\n".join(lines))[1] for lines in typed["part_b"][1:3]]
    assert recover_secret([first], extra_pieces=pieces) == typed["secret"]
    for case in typed["as_people_type"]:
        assert read_sheet(case["text"]) == first, case["name"]
    for bad in typed["bad_lines"]:
        with pytest.raises(SheetError) as refusal:
            read_parts(bad["line"])
        assert refusal.value.name == "bad-line", bad["name"]


def test_the_published_cases_are_exactly_what_the_generator_makes():
    # The generator uses fixed "random" bytes, so this also pins down every
    # byte of what split_secret produces.
    sys.path.insert(0, str(ROOT / "tools"))
    import make_sheet_vectors

    on_disk = (ROOT / "tests" / "vectors" / "sheets_v1.json").read_text(encoding="utf-8")
    assert make_sheet_vectors.as_text(make_sheet_vectors.build()) == on_disk
