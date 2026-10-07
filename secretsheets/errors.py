"""What can be wrong with sheets, as exceptions.

Each kind has a short fixed `name` (SPEC.md, section 7). The names are part of
the format: the test cases shared between the Python and web versions say
which name each damaged sheet must produce.
"""


class SheetError(Exception):
    """Something is wrong with one or more sheets. The message is written for
    the person trying to recover a secret, not for a programmer."""

    name = "sheet-error"


class BadLine(SheetError):
    name = "bad-line"

    def __init__(self, message: str, line: str = ""):
        super().__init__(message)
        self.line = line    # which line, such as "B02", when that is known


class Malformed(SheetError):
    name = "malformed"


class UnsupportedVersion(SheetError):
    name = "unsupported-version"


class MixedSets(SheetError):
    name = "mixed-sets"


class WrongPiece(SheetError):
    name = "wrong-piece"


class TooFew(SheetError):
    name = "too-few"


class CannotUnlock(SheetError):
    name = "cannot-unlock"
