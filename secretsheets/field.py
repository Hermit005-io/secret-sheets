"""Arithmetic on bytes as elements of GF(2^8), the field with 256 elements.

This is the same field AES uses. A byte is read as a polynomial with
coefficients 0 or 1 (bit 3 set means there is an x^3 term) and everything is
done modulo x^8 + x^4 + x^3 + x + 1.

What matters for secret sharing is that this really is a field: every element
except zero has a multiplicative inverse, so equations can be solved exactly,
and there are exactly 256 elements, so a byte in gives a byte out.

Addition and subtraction are the same operation, XOR, because 1 + 1 = 0 when
coefficients are 0 or 1.
"""

MODULUS = 0x11B   # x^8 + x^4 + x^3 + x + 1


def add(a: int, b: int) -> int:
    return a ^ b


def mul(a: int, b: int) -> int:
    """a times b.

    Schoolbook multiplication in binary: for each bit of b that is set, add a
    shifted copy of a, reducing by the modulus whenever a grows past 8 bits.

    It always runs the same eight steps and never looks anything up in a
    table or branches on the values, so what it does is the same whatever the
    bytes are. (`-(bit)` is 0 or -1, and -1 has every bit set, so `x & -(bit)`
    is either 0 or x.) Python cannot promise that this takes exactly the same
    time for every input, but there is no reason to leave an obvious difference in.
    """
    product = 0
    for _ in range(8):
        product ^= a & -(b & 1)
        b >>= 1
        a <<= 1
        a ^= MODULUS & -(a >> 8)
    return product


def inverse(a: int) -> int:
    """The element which, multiplied by a, gives 1.

    The 255 non-zero elements form a group under multiplication, so a^255 = 1
    for all of them, which makes a^254 the inverse of a. 254 is 11111110 in
    binary: square seven times and multiply the squares together.
    """
    if a == 0:
        raise ZeroDivisionError("zero has no inverse")
    result = 1
    for _ in range(7):
        a = mul(a, a)
        result = mul(result, a)
    return result


def div(a: int, b: int) -> int:
    return mul(a, inverse(b))
