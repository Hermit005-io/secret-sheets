"""The field arithmetic, checked for every pair of bytes there is."""

import pytest

from secretsheets import field


def slow_mul(a: int, b: int) -> int:
    """Multiplication done the long way, to compare against: multiply the two
    polynomials in full, then divide by the modulus and keep the remainder."""
    product = 0
    for bit in range(8):
        if b >> bit & 1:
            product ^= a << bit
    for bit in range(14, 7, -1):
        if product >> bit & 1:
            product ^= field.MODULUS << (bit - 8)
    return product


def test_the_worked_example_from_the_aes_standard():
    assert field.mul(0x57, 0x83) == 0xC1


def test_multiplication_agrees_with_long_multiplication_for_every_pair():
    for a in range(256):
        for b in range(256):
            assert field.mul(a, b) == slow_mul(a, b), (a, b)


def test_every_byte_except_zero_has_an_inverse():
    for a in range(1, 256):
        assert field.mul(a, field.inverse(a)) == 1
    with pytest.raises(ZeroDivisionError):
        field.inverse(0)


def test_one_and_zero_behave_as_one_and_zero():
    for a in range(256):
        assert field.mul(a, 1) == a
        assert field.mul(a, 0) == 0
        assert field.add(a, 0) == a
        assert field.add(a, a) == 0      # every element is its own negative


def test_division_undoes_multiplication():
    for a in range(256):
        for b in range(1, 256, 7):
            assert field.div(field.mul(a, b), b) == a


def test_multiplying_distributes_over_adding():
    # Not every triple (that is 16 million); every pair with a spread of thirds.
    for a in range(256):
        for b in range(256):
            for c in (0, 1, 2, 0x53, 0xCA, 0xFF):
                assert field.mul(a, b ^ c) == field.mul(a, b) ^ field.mul(a, c)


def test_multiplying_by_a_non_zero_byte_shuffles_the_bytes():
    # This is what makes one piece say nothing: see test_shamir.py.
    everything = list(range(256))
    for x in range(1, 256):
        assert sorted(field.mul(c, x) for c in range(256)) == everything
