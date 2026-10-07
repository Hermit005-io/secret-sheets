"""The words on a sheet: what a holder reads, possibly years later and with
nobody to ask. They have to stand on their own.

The web page prints the same sentences (web/src/strings.ts), and adds a code
to scan, which a text file cannot hold. Keep the two in step, PAGE_ADDRESS
included.
"""

import textwrap

from . import written
from .sheet import Sheet

WIDTH = 72

# Where the web page lives, so that a holder can find it years later.
PAGE_ADDRESS = "https://hermit005-io.github.io/secret-sheets/"


def rule_sentence(needed: int, total: int) -> str:
    """The rule of a set in plain words."""
    if needed < total:
        return f"Any {needed} of the {total} sheets recover the secret."
    if total == 2:
        return "Both sheets are needed to recover the secret."
    return f"All {total} sheets are needed to recover the secret."


def what_this_is(needed: int, total: int, owner: str = "") -> str:
    start = f"{owner or 'Someone'} has trusted you with one of {total} sheets."
    if total == 2:
        return f"{start} The two together unlock a secret. Either one alone unlocks nothing."
    how_many = f"all {total}" if needed == total else f"any {needed}"
    alone = ("This sheet alone unlocks nothing." if needed == 2 else
             f"This sheet alone unlocks nothing, and neither do any {needed - 1} of them.")
    return f"{start} Together, {how_many} of them unlock a secret. {alone}"


def how_to_recover(needed: int, total: int) -> str:
    bring = ("Bring both sheets together" if total == 2 else
             f"Bring all {total} sheets together" if needed == total else
             f"Bring {needed} of the sheets together")
    return (f"{bring} and check that they show the same set code. Then open the Secret "
            "Sheets page, choose \"Recover a secret\", and type them in. Copy every line of "
            "Part A and Part B, including the two characters at the end of each line.")


def sheet_text(sheet: Sheet, holder: str = "", owner: str = "") -> str:
    """One sheet as plain text, ready to print. `holder` is who it is for and
    `owner` is who it is from; both are optional and only printed. Names of
    up to 40 characters fit the layout."""
    locked, piece = sheet.locked, sheet.piece
    title = f"SECRET SHEET {piece.number} OF {locked.total}"
    facts = [("Purpose", locked.label), ("From", owner),
             ("Made on", f"{locked.made_on.day} {locked.made_on:%B %Y}"),
             ("Set code", locked.set_code())]

    def paragraph(text: str) -> list[str]:
        return textwrap.wrap(text, WIDTH, break_on_hyphens=False)

    lines = [
        title + (f"for {holder}".rjust(WIDTH - len(title)) if holder else ""),
        "=" * WIDTH,
        "",
        *(line for name, value in facts if value
          for line in textwrap.wrap(value, WIDTH, initial_indent=f"{name + ':':<10} ",
                                    subsequent_indent=" " * 11, break_on_hyphens=False)),
        "",
        "WHAT THIS IS",
        *paragraph(what_this_is(locked.needed, locked.total, owner)),
        "",
        "WHAT TO DO",
        "Keep this sheet somewhere safe and dry, where you will find it again.",
        "Do not keep a photo or a copy of it on a phone, on a computer or online.",
        *paragraph(f"If you lose it, tell {owner or 'the person who gave it to you'}."),
        "",
        "TO RECOVER THE SECRET",
        *paragraph(how_to_recover(locked.needed, locked.total)),
        # On a line of its own and with nothing after it, so that no full stop
        # is typed as part of the address.
        *([f"The page is at {PAGE_ADDRESS}"] if PAGE_ADDRESS else []),
        "",
        "PART A   (the same on every sheet of this set)",
        *written.typed_lines("A", locked.to_bytes()),
        "",
        f"PART B   (sheet {piece.number} of {locked.total} only)",
        *written.typed_lines("B", piece.to_bytes()),
        "",
    ]
    return "\n".join(lines)
