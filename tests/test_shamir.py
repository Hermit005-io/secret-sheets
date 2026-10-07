import json
import random
import secrets
from pathlib import Path

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st

from secretsheets import shamir

VECTORS = Path(__file__).parent / "vectors"


def zeros(count: int) -> bytes:
    return bytes(count)


# ---- any `needed` pieces rebuild the secret -------------------------------------------
@st.composite
def a_split(draw):
    secret = draw(st.binary(min_size=1, max_size=64))
    total = draw(st.integers(2, 12))
    needed = draw(st.integers(2, total))
    xs = draw(st.lists(st.integers(1, 255), min_size=total, max_size=total, unique=True))
    used = draw(st.lists(st.sampled_from(range(total)), min_size=needed, unique=True))
    return secret, needed, xs, used


@given(a_split())
@settings(max_examples=300, deadline=None)
def test_any_selection_of_enough_pieces_rebuilds_the_secret(case):
    secret, needed, xs, used = case
    pieces = shamir.split(secret, needed, xs, secrets.token_bytes)
    assert all(len(piece) == len(secret) for piece in pieces)
    assert shamir.combine([(xs[i], pieces[i]) for i in used]) == secret


def test_one_piece_too_few_does_not_rebuild_the_secret():
    secret = secrets.token_bytes(32)
    xs = [1, 2, 3, 4, 5]
    pieces = shamir.split(secret, 3, xs, secrets.token_bytes)
    assert shamir.combine(list(zip(xs, pieces, strict=True))[:2]) != secret


def test_pieces_made_by_the_audited_library_rebuild_here():
    cases = json.loads((VECTORS / "library_shares.json").read_text())["cases"]
    assert len(cases) >= 100
    chooser = random.Random(1)
    for case in cases:
        secret = bytes.fromhex(case["secret"])
        shares = [bytes.fromhex(share) for share in case["shares"]]
        points = [(share[-1], share[:-1]) for share in shares]   # the library puts x last
        assert shamir.combine(points) == secret
        assert shamir.combine(chooser.sample(points, case["needed"])) == secret


# ---- how the random bytes are used -----------------------------------------------------
def test_a_piece_is_the_polynomial_evaluated_at_its_coordinate():
    # Secret byte 1, one coefficient 2, so f(x) = 1 + 2x. In this field
    # 2 * 3 = 6 and 1 + 6 = 7.
    assert shamir.split(b"\x01", 2, [3, 1], lambda count: b"\x02") == [b"\x07", b"\x03"]
    # Two coefficients, used in order: f(x) = 5 + 1x + 1x^2, and f(2) = 5 + 2 + 4 = 3.
    assert shamir.split(b"\x05", 3, [2, 1, 7], lambda count: b"\x01\x01")[0] == b"\x03"


def test_coefficients_are_taken_byte_by_byte_of_the_secret():
    asked = []

    def source(count: int) -> bytes:
        asked.append(count)
        return bytes([9, 9, 0, 0])      # 9, 9 for the first byte; 0, 0 for the second

    first, second = zip(*shamir.split(b"\xAA\xBB", 3, [1, 2, 3], source), strict=True)
    assert asked == [4]                        # (needed - 1) per byte, in one request
    assert set(second) == {0xBB}               # all-zero coefficients: f is constant
    assert set(first) != {0xAA}


def test_all_zero_coefficients_are_allowed():
    # Zero is as likely as any other value and must not be "fixed".
    assert shamir.split(b"key", 3, [1, 2, 3, 4], zeros) == [b"key"] * 4


# ---- fewer pieces than needed say nothing -----------------------------------------------
# The claim: with one piece too few, every possible secret is exactly as
# likely as before. For a single byte this can be checked by counting.

@pytest.mark.parametrize("x", [1, 2, 3, 29, 128, 255])
def test_one_piece_of_a_two_piece_rule_says_nothing(x):
    # For every secret, as the coefficient runs over its 256 values the piece
    # takes each of its 256 values exactly once. So seeing the piece rules
    # out no secret. (test_field.py checks the reason for every x, not only
    # these six: multiplying by x shuffles the bytes.)
    everything = list(range(256))
    for secret in range(256):
        seen = sorted(shamir._evaluate(secret, bytes([c]), x) for c in range(256))
        assert seen == everything


@pytest.mark.parametrize("x1, x2", [(1, 2), (7, 200), (254, 255)])
@pytest.mark.parametrize("secret", [0x00, 0x01, 0xA7, 0xFF])
def test_two_pieces_of_a_three_piece_rule_say_nothing(secret, x1, x2):
    # The same, for two pieces at once: over all 65,536 pairs of
    # coefficients, every pair of piece values turns up exactly once.
    seen = set()
    for c1 in range(256):
        for c2 in range(256):
            coefficients = bytes([c1, c2])
            seen.add((shamir._evaluate(secret, coefficients, x1),
                      shamir._evaluate(secret, coefficients, x2)))
    assert len(seen) == 65536


# ---- refusing nonsense -------------------------------------------------------------------
@pytest.mark.parametrize("xs", [[1, 1], [0, 1], [1, 256], [3, 4, 3]])
def test_coordinates_must_be_different_and_between_1_and_255(xs):
    with pytest.raises(ValueError):
        shamir.split(b"secret", 2, xs, secrets.token_bytes)
    with pytest.raises(ValueError):
        shamir.combine([(x, b"piece!") for x in xs])


@pytest.mark.parametrize("needed", [0, 1, 4])
def test_the_rule_must_be_possible(needed):
    with pytest.raises(ValueError):
        shamir.split(b"secret", needed, [1, 2, 3], secrets.token_bytes)


def test_other_nonsense():
    with pytest.raises(ValueError):
        shamir.split(b"", 2, [1, 2], secrets.token_bytes)
    with pytest.raises(ValueError):
        shamir.combine([(1, b"long piece"), (2, b"short")])
    with pytest.raises(ValueError):
        shamir.split(b"secret", 2, [1, 2], lambda count: b"too few")
