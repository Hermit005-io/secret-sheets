import io
import os
import stat

import pytest

from secretsheets.cli import main

SECRET = "correct horse battery staple"


@pytest.fixture
def sheets(tmp_path, monkeypatch):
    """A folder holding a 3-of-5 set made through the command line."""
    monkeypatch.setattr("sys.stdin", io.StringIO(SECRET + "\n"))
    folder = tmp_path / "sheets"
    assert main(["split", "--needed", "3", "--total", "5", "--label", "Email codes",
                 "--names", "Ama, Kofi, Esi, Yaw, Abena", "--out", str(folder)]) == 0
    return folder


def paths(folder, *numbers):
    return [str(folder / f"sheet-{n}.txt") for n in numbers]


def test_split_writes_one_readable_sheet_per_person(sheets):
    assert sorted(path.name for path in sheets.iterdir()) == [f"sheet-{n}.txt" for n in range(1, 6)]
    text = (sheets / "sheet-2.txt").read_text(encoding="utf-8")
    assert "SECRET SHEET 2 OF 5" in text and "for Kofi" in text
    assert "Purpose:   Email codes" in text
    assert "PART B   (sheet 2 of 5 only)" in text
    assert "The page is at https://hermit005-io.github.io/secret-sheets/\n" in text
    assert "any 3 of them unlock a secret" in " ".join(text.split())
    assert SECRET not in text
    assert max(map(len, text.splitlines())) <= 72


def test_the_owners_name_is_printed_when_given(tmp_path, monkeypatch):
    monkeypatch.setattr("sys.stdin", io.StringIO(SECRET))
    assert main(["split", "--needed", "2", "--total", "2", "--owner", "Ama Mensah",
                 "--out", str(tmp_path / "s")]) == 0
    text = " ".join((tmp_path / "s" / "sheet-1.txt").read_text(encoding="utf-8").split())
    assert "From: Ama Mensah" in text
    assert "Ama Mensah has trusted you with one of 2 sheets. The two together unlock" in text
    assert "If you lose it, tell Ama Mensah." in text


def test_split_says_what_it_made_and_what_to_do_next(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr("sys.stdin", io.StringIO(SECRET))
    assert main(["split", "--needed", "2", "--total", "3", "--out", str(tmp_path / "s")]) == 0
    out = capsys.readouterr().out
    assert "Made 3 sheets" in out and "set code" in out
    assert "Any 2 of the 3 sheets recover the secret." in out
    assert "try a recovery from the printed sheets" in out


def test_recover_prints_the_secret(sheets, capsys):
    capsys.readouterr()
    assert main(["recover", *paths(sheets, 5, 1, 3)]) == 0
    assert capsys.readouterr().out == SECRET + "\n"


def test_recover_with_too_few_explains_and_fails(sheets, capsys):
    capsys.readouterr()
    assert main(["recover", *paths(sheets, 1, 2)]) == 1
    printed = capsys.readouterr()
    assert printed.out == ""
    assert "3 different sheets are needed" in printed.err


def test_recover_accepts_sheets_with_only_part_b(sheets, capsys):
    for number in (2, 4):
        path = sheets / f"sheet-{number}.txt"
        text = path.read_text(encoding="utf-8")
        path.write_text(text[text.index("PART B"):], encoding="utf-8")
    capsys.readouterr()
    assert main(["recover", *paths(sheets, 2, 3, 4)]) == 0
    assert capsys.readouterr().out == SECRET + "\n"


def test_a_mistyped_line_is_reported_with_its_file_and_line(sheets, capsys):
    path = sheets / "sheet-4.txt"
    lines = path.read_text(encoding="utf-8").splitlines()
    at = next(i for i, line in enumerate(lines) if line.startswith("B02"))
    wrong = "0" if lines[at][5] != "0" else "1"
    lines[at] = lines[at][:5] + wrong + lines[at][6:]
    path.write_text("\n".join(lines), encoding="utf-8")
    capsys.readouterr()
    assert main(["recover", *paths(sheets, 1, 2, 4)]) == 1
    message = capsys.readouterr().err
    assert "sheet-4.txt" in message and "Line B02" in message


def test_check_reports_an_intact_sheet(sheets, capsys):
    capsys.readouterr()
    assert main(["check", *paths(sheets, 3)]) == 0
    out = capsys.readouterr().out
    assert "This sheet is intact. It is sheet 3 of 5 for \"Email codes\"" in out
    assert "Any 3 of the 5 sheets recover the secret." in out


def test_split_never_overwrites_an_existing_set(sheets, monkeypatch, capsys):
    before = (sheets / "sheet-1.txt").read_text(encoding="utf-8")
    monkeypatch.setattr("sys.stdin", io.StringIO("another secret\n"))
    assert main(["split", "--needed", "2", "--total", "2", "--out", str(sheets)]) == 1
    assert "already exists" in capsys.readouterr().err
    assert (sheets / "sheet-1.txt").read_text(encoding="utf-8") == before


def test_a_refused_split_leaves_nothing_behind(tmp_path, monkeypatch, capsys):
    # One file in the way, late in the set: none of the new set may be written,
    # or the folder would hold enough of it to recover the secret.
    folder = tmp_path / "s"
    folder.mkdir()
    (folder / "sheet-3.txt").write_text("old", encoding="utf-8")
    monkeypatch.setattr("sys.stdin", io.StringIO(SECRET))
    assert main(["split", "--needed", "2", "--total", "3", "--out", str(folder)]) == 1
    assert "already exists" in capsys.readouterr().err
    assert [path.name for path in folder.iterdir()] == ["sheet-3.txt"]


class NeverRead(io.StringIO):
    def read(self, *_):
        raise AssertionError("the secret was asked for")


@pytest.mark.parametrize("arguments, complaint", [
    (["--needed", "4", "--total", "3"], "no more than"),
    (["--needed", "2", "--total", "30"], "number of sheets"),
    (["--needed", "2", "--total", "3", "--label", "x" * 65], "label"),
    (["--needed", "2", "--total", "3", "--names", "Ama,Kofi"], "--names lists 2 people"),
])
def test_what_can_be_refused_is_refused_before_the_secret_is_asked_for(
        arguments, complaint, tmp_path, monkeypatch, capsys):
    monkeypatch.setattr("sys.stdin", NeverRead())
    assert main(["split", *arguments, "--out", str(tmp_path / "s")]) == 1
    assert complaint in capsys.readouterr().err
    assert not (tmp_path / "s").exists()


@pytest.mark.skipif(os.name == "nt", reason="Windows has no such permissions")
def test_sheet_files_are_readable_only_by_their_owner(sheets):
    for path in sheets.iterdir():
        assert stat.S_IMODE(path.stat().st_mode) == 0o600


@pytest.mark.parametrize("option, value", [
    ("--owner", "B04 0000"),
    ("--owner", "Vitamin B12 Ltd"),         # a line of the page could start at "B12"
    ("--owner", "Vitamin B12"),
    ("--names", "Ama,A10 Tank"),
    ("--label", "Locker a07"),
    ("--owner", "x" * 41),
    ("--owner", "Jos\udce9"),               # a name the terminal passed on in another encoding
    ("--names", "Ama,Kofi\x1b[2J"),
])
def test_names_that_cannot_be_printed_safely_are_refused_before_the_secret_is_asked_for(
        option, value, tmp_path, monkeypatch, capsys):
    monkeypatch.setattr("sys.stdin", NeverRead())
    assert main(["split", "--needed", "2", "--total", "2", option, value,
                 "--out", str(tmp_path / "s")]) == 1
    assert capsys.readouterr().err.strip()
    assert not (tmp_path / "s").exists()


def test_a_place_that_cannot_hold_the_sheets_is_refused_before_the_secret_is_asked_for(
        tmp_path, monkeypatch, capsys):
    monkeypatch.setattr("sys.stdin", NeverRead())
    (tmp_path / "afile").write_text("not a folder", encoding="utf-8")
    for out in (tmp_path / "afile", tmp_path / "afile" / "inside"):
        assert main(["split", "--needed", "2", "--total", "2", "--out", str(out)]) == 1
        assert "is not a folder" in capsys.readouterr().err
    (tmp_path / "s").mkdir()
    (tmp_path / "s" / "sheet-2.txt").symlink_to(tmp_path / "nowhere")    # a dangling link
    assert main(["split", "--needed", "2", "--total", "2", "--out", str(tmp_path / "s")]) == 1
    assert "already exists" in capsys.readouterr().err


def test_an_interrupted_split_leaves_nothing_behind(tmp_path, monkeypatch):
    # Ctrl-C while the third of five files is being made. Two files of a
    # 2-of-5 set would be enough to recover the secret, so none may remain.
    real_open, calls = os.open, []

    def interrupted(path, *arguments):
        calls.append(path)
        if len(calls) == 3:
            raise KeyboardInterrupt
        return real_open(path, *arguments)

    monkeypatch.setattr("sys.stdin", io.StringIO(SECRET))
    monkeypatch.setattr(os, "open", interrupted)
    with pytest.raises(KeyboardInterrupt):
        main(["split", "--needed", "2", "--total", "5", "--out", str(tmp_path / "s")])
    assert list((tmp_path / "s").iterdir()) == []


def test_a_blank_secret_is_refused(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr("sys.stdin", io.StringIO("   \n"))
    assert main(["split", "--needed", "2", "--total", "2", "--out", str(tmp_path / "s")]) == 1
    assert "There is no secret to split." in capsys.readouterr().err
    assert not (tmp_path / "s").exists()


def test_the_longest_names_still_fit_the_page(tmp_path, monkeypatch):
    monkeypatch.setattr("sys.stdin", io.StringIO(SECRET))
    name = "Wolfeschlegelsteinhausenbergerdorff-Smith"[:40]
    assert main(["split", "--needed", "2", "--total", "20", "--names", ",".join([name] * 20),
                 "--owner", name, "--label", "x" * 64, "--out", str(tmp_path / "s")]) == 0
    lines = (tmp_path / "s" / "sheet-20.txt").read_text(encoding="utf-8").splitlines()
    assert lines[0] == "SECRET SHEET 20 OF 20" + f"for {name}".rjust(72 - 21)
    assert max(map(len, lines)) <= 72


def test_a_piped_secret_is_read_as_utf8_whatever_the_computer_prefers(
        tmp_path, monkeypatch, capsys):
    secret = "pässwörd 密碼"
    piped = io.TextIOWrapper(io.BytesIO(("\ufeff" + secret + "\r\n").encode("utf-8")),
                             encoding="cp1252")
    monkeypatch.setattr("sys.stdin", piped)
    folder = tmp_path / "s"
    assert main(["split", "--needed", "2", "--total", "2", "--out", str(folder)]) == 0
    capsys.readouterr()
    assert main(["recover", *paths(folder, 1, 2)]) == 0
    assert capsys.readouterr().out == secret + "\n"


def test_a_secret_with_a_space_at_the_end_is_kept_and_remarked_on(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr("sys.stdin", io.StringIO("hunter2 \n"))
    folder = tmp_path / "s"
    assert main(["split", "--needed", "2", "--total", "2", "--out", str(folder)]) == 0
    assert "begins or ends with a space" in capsys.readouterr().out
    assert main(["recover", *paths(folder, 1, 2)]) == 0
    assert capsys.readouterr().out == "hunter2 \n"


def test_a_file_saved_by_another_editor_is_still_read(sheets, capsys):
    # Windows Notepad's "UTF-8 with BOM" and its line endings.
    for number in (1, 2, 3):
        path = sheets / f"sheet-{number}.txt"
        text = path.read_text(encoding="utf-8").replace("\n", "\r\n")
        path.write_bytes(b"\xef\xbb\xbf" + text.encode("utf-8"))
    capsys.readouterr()
    assert main(["recover", *paths(sheets, 1, 2, 3)]) == 0
    assert capsys.readouterr().out == SECRET + "\n"


def test_a_file_that_is_not_text_or_not_a_sheet_is_a_plain_message(tmp_path, capsys):
    (tmp_path / "photo.jpg").write_bytes(bytes(range(256)))
    assert main(["check", str(tmp_path / "photo.jpg")]) == 1
    assert "photo.jpg is not a text file" in capsys.readouterr().err
    (tmp_path / "notes.txt").write_text("Remember the milk.", encoding="utf-8")
    assert main(["recover", str(tmp_path / "notes.txt")]) == 1
    assert "No sheet was found" in capsys.readouterr().err


def test_a_rule_needing_every_sheet_says_so(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr("sys.stdin", io.StringIO(SECRET))
    assert main(["split", "--needed", "3", "--total", "3", "--out", str(tmp_path / "s")]) == 0
    assert "All 3 sheets are needed to recover the secret." in capsys.readouterr().out
    text = " ".join((tmp_path / "s" / "sheet-1.txt").read_text(encoding="utf-8").split())
    assert "Together, all 3 of them unlock a secret." in text
    assert "neither do any 2 of them" in text
    assert "Bring all 3 sheets together" in text


def test_names_must_match_the_number_of_sheets(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr("sys.stdin", io.StringIO(SECRET))
    assert main(["split", "--needed", "2", "--total", "3", "--names", "Ama,Kofi",
                 "--out", str(tmp_path / "s")]) == 1
    assert "--names lists 2 people" in capsys.readouterr().err
    assert not (tmp_path / "s").exists()


def test_a_missing_file_is_a_plain_message_not_a_crash(tmp_path, capsys):
    assert main(["recover", str(tmp_path / "nowhere.txt")]) == 1
    assert "nowhere.txt" in capsys.readouterr().err
