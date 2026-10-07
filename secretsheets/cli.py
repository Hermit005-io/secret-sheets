"""The commands:

    python -m secretsheets split --needed 3 --total 5 --label "Email codes" --out sheets
    python -m secretsheets recover sheets/sheet-1.txt sheets/sheet-3.txt sheets/sheet-5.txt
    python -m secretsheets check sheets/sheet-2.txt
"""

import argparse
import getpass
import os
import sys
from pathlib import Path

from . import core
from .errors import SheetError
from .page import rule_sentence, sheet_text
from .sheet import MAX_SHEETS, is_printable
from .written import starts_like_a_line

MAX_NAME_CHARACTERS = 40


def main(arguments: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="secretsheets",
        description="Split a secret into sheets for people you trust, and recover it.")
    commands = parser.add_subparsers(dest="command", required=True)

    split = commands.add_parser("split", help="make a set of sheets from a secret")
    split.add_argument("--total", type=int, required=True,
                       help=f"how many sheets to make (2 to {MAX_SHEETS})")
    split.add_argument("--needed", type=int, required=True,
                       help="how many of them are needed to recover the secret")
    split.add_argument("--label", default="",
                       help="printed on every sheet for anyone to read, e.g. \"Email codes\"")
    split.add_argument("--owner", default="",
                       help="your name, printed on every sheet so that its holder knows "
                            "who it came from (optional)")
    split.add_argument("--names", default="",
                       help="who gets each sheet, separated by commas (optional)")
    split.add_argument("--out", type=Path, default=Path("sheets"),
                       help="folder to write the sheets into (default: sheets)")
    split.add_argument("--show", action="store_true",
                       help="show the secret while it is typed")
    split.epilog = ("The secret is asked for, never given on the command line. It can "
                    "also be piped in as UTF-8 text; line breaks at its end are dropped.")

    recover = commands.add_parser("recover", help="recover the secret from sheets")
    recover.add_argument("sheets", nargs="+", type=Path, help="sheet files")

    check = commands.add_parser("check", help="check that a sheet is intact")
    check.add_argument("sheet", type=Path, help="a sheet file")

    options = parser.parse_args(arguments)
    try:
        return {"split": _split, "recover": _recover, "check": _check}[options.command](options)
    except OSError as problem:
        where = f": {problem.filename}" if problem.filename else ""
        print(f"\n{problem.strerror or problem}{where}", file=sys.stderr)
    except (SheetError, ValueError) as problem:
        print(f"\n{problem}", file=sys.stderr)
    return 1


def _split(options) -> int:
    # Everything that can be refused is refused before the secret is asked for.
    core.check_rule(options.needed, options.total, options.label)
    owner = options.owner.strip()
    names = [name.strip() for name in options.names.split(",")] if options.names else []
    if names and len(names) != options.total:
        raise ValueError(f"--names lists {len(names)} people, but --total is {options.total}.")
    for name in [*names, owner]:
        _check_name(name)
    if _holds_a_line(options.label):
        raise ValueError(f"Part of the label \"{options.label}\" looks like a line of a sheet "
                         "(such as \"A01\"), and would be mistaken for one. Please change it.")
    paths = [options.out / f"sheet-{number}.txt" for number in range(1, options.total + 1)]
    _check_folder(options.out)
    _refuse_to_overwrite(paths)

    secret = _ask_for_secret(options.show)
    if not secret.strip():
        raise ValueError("There is no secret to split.")
    sheets = core.split_secret(secret, options.needed, options.total, options.label)
    texts = [sheet_text(sheet, names[i] if names else "", owner).encode("utf-8")
             for i, sheet in enumerate(sheets)]
    # What is about to be written must read back as these sheets and no others.
    if not all(map(_reads_back, texts, sheets)):
        raise ValueError("The sheets did not read back as they were made, so nothing was "
                         "written. Try without --names, --owner and --label.")

    options.out.mkdir(parents=True, exist_ok=True)
    _refuse_to_overwrite(paths)
    made = []
    try:
        for path, text in zip(paths, texts, strict=True):
            # Made new, never replaced, and readable only by this user.
            handle = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            made.append(path)
            with open(handle, "wb") as file:
                file.write(text)
    except BaseException:
        # All of the set or none of it, even if the program is interrupted:
        # part of a set could be enough sheets to recover the secret.
        for path in made:
            path.unlink(missing_ok=True)
        raise

    print(f"\nMade {options.total} sheets in {options.out}{'/' if options.out.name else ''} "
          f"(set code {sheets[0].locked.set_code()}).")
    print(rule_sentence(options.needed, options.total))
    if secret != secret.strip():
        print("Note: the secret begins or ends with a space. It is kept exactly as given.")
    print("Print each one, try a recovery from the printed sheets, then delete the files.")
    return 0


def _check_name(name: str) -> None:
    """Raise ValueError unless `name` can be printed on a sheet as it is."""
    try:
        name.encode("utf-8")
    except UnicodeEncodeError:
        raise ValueError("A name contains something that is not a character. If it has "
                         "accented letters, check the terminal is set to UTF-8.") from None
    if not is_printable(name):
        raise ValueError("Names must be plain text.")
    if len(name) > MAX_NAME_CHARACTERS:
        raise ValueError(f"The name \"{name}\" is too long (the limit is "
                         f"{MAX_NAME_CHARACTERS} characters).")
    if _holds_a_line(name):
        raise ValueError(f"Part of the name \"{name}\" looks like a line of a sheet (such as "
                         "\"A01\"), and would be mistaken for one. Please change it.")


def _holds_a_line(text: str) -> bool:
    """Whether `text` could be read as a typed line of a sheet, were a line
    of the page to start at any one of its words."""
    words = [*text.split(), "."]        # on the page, more always follows a name
    return any(starts_like_a_line(" ".join(words[i:])) for i in range(len(words)))


def _reads_back(text: bytes, sheet: core.Sheet) -> bool:
    try:
        return core.read_sheet(text.decode("utf-8")) == sheet
    except SheetError:
        return False


def _check_folder(folder: Path) -> None:
    """Raise ValueError unless sheets can be written into `folder`, which may
    not exist yet. Nothing is created."""
    nearest = folder
    while not os.path.lexists(nearest) and nearest != nearest.parent:
        nearest = nearest.parent
    if not nearest.is_dir():
        raise ValueError(f"{nearest} is not a folder. Choose another place with --out.")
    if not os.access(nearest, os.W_OK | os.X_OK):
        raise ValueError(f"Files cannot be made in {nearest}. Choose another place with --out.")


def _refuse_to_overwrite(paths: list[Path]) -> None:
    for path in paths:
        if os.path.lexists(path):
            raise ValueError(f"{path} already exists. Choose another folder with --out, so "
                             "that sheets from two sets are never mixed up.")


def _ask_for_secret(show: bool) -> str:
    if not sys.stdin.isatty():
        # Piped in, e.g. from a file. Read as UTF-8 whatever this computer's
        # usual encoding is, so that the secret is the same everywhere.
        raw = getattr(sys.stdin, "buffer", None)
        try:
            text = raw.read().decode("utf-8-sig") if raw else sys.stdin.read()
        except UnicodeDecodeError:
            raise ValueError("The secret piped in is not UTF-8 text.") from None
        return text.rstrip("\r\n")
    ask = input if show else getpass.getpass
    secret = ask("Secret: ")
    if not show and getpass.getpass("Again, to be sure: ") != secret:
        raise ValueError("Those two were not the same. Nothing was made.")
    return secret


def _read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError:
        raise ValueError(f"{path} is not a text file.") from None


def _recover(options) -> int:
    sheets, pieces = [], []
    for path in options.sheets:
        try:
            locked, piece = core.read_parts(_read(path))
        except SheetError as problem:
            problem.args = (f"{path}: {problem}",)      # say which file
            raise
        if piece is None:
            raise ValueError(f"{path}: Part B, the sheet's own piece, was not found.")
        if locked is None:
            pieces.append(piece)
        else:
            sheets.append(core.Sheet(locked, piece))
    secret = core.recover_secret(sheets, pieces)
    try:
        print(secret)
    except UnicodeEncodeError:
        raise ValueError("The secret was recovered, but this terminal cannot show some of its "
                         "characters. Set the environment variable PYTHONUTF8 to 1 and run "
                         "the command again.") from None
    return 0


def _check(options) -> int:
    sheet = core.read_sheet(_read(options.sheet))
    report = core.check_sheet(sheet)
    if not report.intact:
        print(f"This sheet will not work. Its Part B is not the one that belongs to sheet "
              f"{report.number} of set {report.set_code}.")
        return 1
    print(f"This sheet is intact. It is sheet {report.number} of {report.total}"
          + (f" for \"{report.label}\"" if report.label else "") + ".")
    print(f"Set code {report.set_code}, made on {report.made_on.day} "
          f"{report.made_on:%B %Y}. {rule_sentence(report.needed, report.total)}")
    return 0
