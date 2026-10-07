"""Shamir's secret sharing over GF(2^8), one byte at a time.

The idea, for one byte s of the secret and a rule of "any k pieces":

    pick k - 1 random bytes c1 .. c(k-1), and let
        f(x) = s + c1*x + c2*x^2 + ... + c(k-1)*x^(k-1)
    the piece with coordinate x holds f(x).

f is a polynomial of degree k - 1, and k points determine such a polynomial
completely, so any k pieces give back f and with it f(0) = s. With only k - 1
pieces, every possible value of s fits exactly one polynomial through them, so
all 256 values stay equally likely: the pieces say nothing about s.

That second claim needs the coefficients to be uniformly random over all 256
values. Zero must be allowed, including for the top coefficient: ruling it out
looks tidier (the polynomial then always has full degree) but makes some
combinations of pieces impossible, and that is information.

See SPEC.md, section 4. The arithmetic is in field.py.
"""

from collections.abc import Callable, Sequence

from . import field


def split(secret: bytes, needed: int, xs: Sequence[int],
          random_bytes: Callable[[int], bytes]) -> list[bytes]:
    """Split `secret` so that any `needed` of the pieces rebuild it.

    Returns one byte string per coordinate in `xs`, each as long as the
    secret. `random_bytes(n)` must return n bytes from a secure generator; it
    is called once, for (needed - 1) bytes per byte of the secret, used in
    order: all the coefficients for the first byte, then the second, and so on.
    """
    _check_coordinates(xs)
    if not 2 <= needed <= len(xs):
        raise ValueError("needed must be at least 2 and at most the number of pieces")
    if not secret:
        raise ValueError("there is nothing to split")

    degree = needed - 1
    randomness = random_bytes(degree * len(secret))
    if len(randomness) != degree * len(secret):
        raise ValueError("the random source returned the wrong number of bytes")

    pieces = [bytearray(len(secret)) for _ in xs]
    for i, byte in enumerate(secret):
        coefficients = randomness[i * degree:(i + 1) * degree]
        for piece, x in zip(pieces, xs, strict=True):
            piece[i] = _evaluate(byte, coefficients, x)
    return [bytes(piece) for piece in pieces]


def combine(points: Sequence[tuple[int, bytes]]) -> bytes:
    """Rebuild the secret from (x, piece) pairs.

    Give it at least as many pieces as the rule needs. With fewer it still
    returns something, of the right length and entirely wrong: nothing in the
    pieces says how many are required, so the caller has to know, and has to
    check the result (core.py does both).
    """
    xs = [x for x, _ in points]
    _check_coordinates(xs)
    lengths = {len(piece) for _, piece in points}
    if len(lengths) != 1:
        raise ValueError("the pieces are not all the same length")

    weights = _weights_at_zero(xs)
    secret = bytearray(lengths.pop())
    for (_, piece), weight in zip(points, weights, strict=True):
        for i, y in enumerate(piece):
            secret[i] ^= field.mul(y, weight)
    return bytes(secret)


def _evaluate(constant: int, coefficients: bytes, x: int) -> int:
    """constant + c1*x + c2*x^2 + ..., by Horner's rule (highest power first)."""
    result = 0
    for coefficient in reversed(coefficients):
        result = field.mul(field.add(result, coefficient), x)
    return field.add(result, constant)


def _weights_at_zero(xs: Sequence[int]) -> list[int]:
    """Lagrange interpolation, evaluated at zero.

    The polynomial through the points is the sum of y_i * L_i(x), where L_i is
    1 at x_i and 0 at every other x_j. At x = 0,

        L_i(0) = product over j != i of  x_j / (x_j - x_i)

    These weights depend only on the coordinates, which are public, so they
    are worked out once and reused for every byte.
    """
    weights = []
    for i, xi in enumerate(xs):
        weight = 1
        for j, xj in enumerate(xs):
            if j != i:
                weight = field.mul(weight, field.div(xj, field.add(xj, xi)))
        weights.append(weight)
    return weights


def _check_coordinates(xs: Sequence[int]) -> None:
    if any(not 1 <= x <= 255 for x in xs):
        raise ValueError("every coordinate must be between 1 and 255")
    if len(set(xs)) != len(xs):
        raise ValueError("two pieces have the same coordinate")
