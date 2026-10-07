"""Check that sheets cross between the Python and web versions, in both
directions, on fresh random sets.

    cd web && npm install && cd ..
    python tools/cross_versions.py          # 200 sets each way
    python tools/cross_versions.py 2000

Needs Node 22.18 or newer, which runs the web version's TypeScript directly.
"""

import json
import random
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

from secretsheets import read_sheet, recover_secret, split_secret, written  # noqa: E402
from secretsheets.page import sheet_text  # noqa: E402

LETTERS = "abcXYZ 0189 .,!? äöüß éèñ ключ 密碼 かな 🔑🌍"


def random_text(low: int, high: int) -> str:
    return "".join(random.choice(LETTERS) for _ in range(random.randint(low, high)))


def python_makes_web_recovers(count: int) -> int:
    sets = []
    for i in range(count):
        total = random.randint(2, 20)
        needed = random.randint(2, total)
        secret = random_text(1, 120 if i % 10 == 0 else 40)
        sheets = split_secret(secret, needed, total, random_text(0, 12))
        # Half as the QR text, half as the whole printed sheet.
        texts = [written.qr_text(sheet.to_bytes()) if i % 2 == 0 else sheet_text(sheet)
                 for sheet in sheets]
        sets.append({"secret": secret, "needed": needed, "sheets": texts})
    checked = subprocess.run(["node", "scripts/recover_sets.ts"], cwd=ROOT / "web", text=True,
                             input=json.dumps({"sets": sets}), capture_output=True,
                             encoding="utf-8")
    print("  " + (checked.stdout.strip() or checked.stderr.strip()))
    return checked.returncode


def web_makes_python_recovers(count: int) -> int:
    made = subprocess.run(["node", "scripts/make_sets.ts", str(count)], cwd=ROOT / "web",
                          capture_output=True, text=True, encoding="utf-8", check=True)
    failures = 0
    for case in json.loads(made.stdout)["sets"]:
        sheets = [read_sheet(text) for text in case["sheets"]]
        chosen = random.sample(sheets, case["needed"])
        if recover_secret(chosen) != case["secret"] or recover_secret(sheets) != case["secret"]:
            failures += 1
    print(f"  {count - failures} of {count} sets recovered correctly by the Python version")
    return failures


def main() -> int:
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 200
    print(f"Python makes the sheets, the web version recovers ({count} sets)")
    first = python_makes_web_recovers(count)
    print(f"The web version makes the sheets, Python recovers ({count} sets)")
    second = web_makes_python_recovers(count)
    return 1 if first or second else 0


if __name__ == "__main__":
    sys.exit(main())
