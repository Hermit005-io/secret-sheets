"""Check the Python maths against the audited library, in both directions,
on fresh random cases.

    cd tools
    npm install
    python cross_check.py            # 2,000 cases each way
    python cross_check.py 20000

Direction 1: the library splits, Python rebuilds.
Direction 2: Python splits, the library rebuilds.

The tests in tests/ run direction 1 on a saved file of cases, so they need no
Node. This script is the fuller check, and runs on GitHub with every change.
"""

import json
import random
import secrets
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE.parent))

from secretsheets import shamir  # noqa: E402


def library_splits_python_rebuilds(count: int) -> int:
    made = subprocess.run(["node", "library_split.mjs", str(count)], cwd=HERE,
                          capture_output=True, text=True, check=True)
    failures = 0
    for case in json.loads(made.stdout)["cases"]:
        secret = bytes.fromhex(case["secret"])
        shares = [bytes.fromhex(share) for share in case["shares"]]
        points = [(share[-1], share[:-1]) for share in shares]
        chosen = random.sample(points, case["needed"])
        if shamir.combine(chosen) != secret or shamir.combine(points) != secret:
            failures += 1
    return failures


def python_splits_library_rebuilds(count: int) -> int:
    cases = []
    for i in range(count):
        total = random.randint(2, 12)
        needed = random.randint(2, total)
        secret = secrets.token_bytes(random.randint(1, 64) if i % 4 == 0 else 32)
        xs = random.sample(range(1, 256), total)
        pieces = shamir.split(secret, needed, xs, secrets.token_bytes)
        cases.append({"secret": secret.hex(), "needed": needed,
                      "shares": [(piece + bytes([x])).hex()
                                 for x, piece in zip(xs, pieces, strict=True)]})
    checked = subprocess.run(["node", "library_combine.mjs"], cwd=HERE, text=True,
                             input=json.dumps({"cases": cases}), capture_output=True)
    print("  " + (checked.stdout.strip() or checked.stderr.strip()))
    return checked.returncode


def main() -> int:
    count = int(sys.argv[1]) if len(sys.argv) > 1 else 2000
    print(f"The library splits, Python rebuilds ({count} cases)")
    wrong = library_splits_python_rebuilds(count)
    print(f"  {count - wrong} of {count} cases rebuilt correctly by Python")
    print(f"Python splits, the library rebuilds ({count} cases)")
    failed = python_splits_library_rebuilds(count)
    return 1 if wrong or failed else 0


if __name__ == "__main__":
    sys.exit(main())
