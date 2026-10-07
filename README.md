# Secret Sheets

Split an important secret into printed sheets for people you trust. Any
number of them that you choose, say 3 of 5, can bring the secret back. Fewer
cannot.

It is for the things a person cannot afford to lose and should not hand to
any one person whole: the master password of a password manager, the recovery
codes for an email account, the combination of a safe.

**To use it, go to <https://hermit005-io.github.io/secret-sheets/>**, or open
[`docs/index.html`](docs/index.html) from a copy of this repository. That one
file is the whole tool. It works with the internet switched off, on a phone
or a laptop, and nothing typed into it is sent anywhere.

## Why

Most people have made no arrangement for their accounts. In an April 2024
survey of 14,631 of its members, the UK consumer group Which? found that 76%
had no plan for their digital accounts after their death and only 18% had
left anyone directions for getting in
([Which?](https://www.which.co.uk/news/article/most-people-have-no-plan-for-digital-death-which-finds-aCp2c3o0NHXT)).

The two obvious fixes both fail. Give the password to one person and you are
trusting that person completely, starting today. Keep it in your head and it
is lost with you. Splitting it among several people avoids both, and the
mathematics for doing that safely has existed since 1979.

Tools for this exist. Several are written for programmers, and one made for
everyone, Ente's [2of3](https://2of3.ente.com/), turns a secret into three
cards of which any two bring it back. This project is about the parts that
are still hard to get right:

- **Your own rule.** Any number of sheets from 2 to 20, and any number of
  them needed.
- **Paper that works without a camera.** Every sheet can be typed back by
  hand, with a check on each line.
- **Never a wrong answer.** A damaged sheet, or one from another set, is
  refused and named. Plain secret sharing returns a wrong secret instead
  (see "A wrong sheet" below).
- **Nothing to take on trust.** The format is written down in full, and two
  independent versions must agree on it.

## What it does

- **Split.** Type the secret, choose how many people get a sheet and how many
  are needed, and print. The page says in plain words what the choice means:
  "If 2 are lost, you can still recover it. If 3 are lost, you cannot."
- **Prove it works.** Before the sheets are handed out, the page asks for
  enough of the *printed* sheets to be scanned back, and confirms the secret
  returns. A faint printer is found now and not in an emergency. Finishing
  without having done so takes a second, deliberate press.
- **Recover.** Scan sheets with the camera, take a photo of each, or type
  them in. The secret appears when there are enough.
- **Check a sheet.** Any holder can confirm their own sheet is intact and
  which set it belongs to, at any time. The secret is never shown.

## How it works

1. A random key is made and used once to lock the secret (AES-256-GCM).
2. The key, not the secret, is cut into pieces using Shamir's secret sharing.
3. Every sheet carries the locked secret and one piece of the key.

Any 3 sheets (if that is the rule you chose) rebuild the key and unlock the
secret. With 2, the pieces give no information about the key at all. That
part is a mathematical fact, not a claim about how hard something is to
compute, and the tests check it by counting cases
([`tests/test_shamir.py`](tests/test_shamir.py)).

A sheet holds more than its piece, though: the locked secret, and a
fingerprint of every piece in the set. So the precise claim for whole sheets
is the ordinary one. Too few of them reveal nothing unless AES-256 or
SHA-256 is broken, the two standard algorithms that most of the internet
also rests on.

### A wrong sheet

Plain secret sharing has no way to tell a right piece from a wrong one. Feed
it a damaged sheet, or one from a different set, and it calmly returns a
wrong secret. For a password, that is the worst outcome: the person cannot
tell whether the sheets are bad or the account has changed.

Here that cannot happen:

- Every sheet lists a fingerprint of every piece in its set, so a bad piece
  is identified, and the message names the sheet.
- The encryption is the kind that refuses a wrong key outright. Nothing is
  ever shown unless it accepted the rebuilt key.

The tests flip every single bit of a sheet, one at a time, and then every
bit of Part A on all the sheets together, and check that the result is
always a refusal and never a wrong secret.

### A sheet you can type

A camera may not be to hand in an emergency, so each sheet also prints its
contents as short lines with a check on the end:

    B02  H7K8-QNB5-ZPNH-YKJ6  99

The check is a CRC, which always catches any single wrong character and any
two neighbouring characters swapped. So a typing mistake is reported on the
line where it happened ("Line B02 has a mistake in it"), not after forty
lines as a mysterious failure. The letters I, L, O and U are never used, and
typing O for 0 or l for 1 is quietly accepted, as are small letters, and
leaving out the spaces and dashes. The locked secret is the same on every
sheet, so it is typed once; each further sheet is four lines.

Most sets are short, and their sheets are printed in large type. Letters
take up different amounts of room on different devices, so the page does not
guess: it lays the sheets out at the size of a printed page, measures them,
and picks the largest of five sizes of type at which each still fits on one.

## Built twice

There are two complete versions, and they read each other's sheets.

| | Web page | Python |
| --- | --- | --- |
| For | everyone | anyone who wants to read and verify the maths |
| Splitting | [`shamir-secret-sharing`](https://github.com/privy-io/shamir-secret-sharing), an independently audited library | written from first principles in [`secretsheets/shamir.py`](secretsheets/shamir.py) |
| Encryption | the browser's built-in Web Crypto | the `cryptography` package |
| Used by | opening `docs/index.html` | commands in a terminal |

The rule this follows: write the cryptography from scratch to understand it,
and stand on reviewed code for what people will depend on. The from-scratch
Python is then held to the audited library's answers, and both versions are
held to one written format, [SPEC.md](SPEC.md), and one published file of
test cases.

## How it is checked

| Check | What it establishes |
| --- | --- |
| Multiplication for all 65,536 pairs of bytes, against long multiplication | The arithmetic everything rests on is right, with no case left out |
| Every possible case counted for one byte of a 2-piece rule; a sample of secrets and places for a 3-piece rule | One piece too few leaves every secret exactly as likely as before |
| The audited library splits and Python rebuilds, and the reverse, on thousands of fresh random cases | The from-scratch maths matches reviewed code |
| Python makes sheets and the web page's code recovers them, and the reverse, on hundreds of fresh random sets | The two versions really are interchangeable |
| Published sets, damaged sheets and badly typed sheets in [`tests/vectors`](tests/vectors), read by both versions | Both give the same answer, and the same refusal for each kind of damage |
| Tens of thousands of sheets mangled at random (stray spaces, swapped and missing characters, shuffled lines, letters from other alphabets) and read by both versions | They agree on every one: the same bytes, or the same refusal naming the same line |
| Every bit of a sheet flipped in turn, in both versions | A damaged sheet is always refused, never misread |
| On a typed line of every possible length: every character changed to every other, every two neighbouring characters swapped (every possible pair of them), every wrong line number | A typing mistake is always caught, on its own line |
| The page driven in a real browser: split, print, prove, recover, check, and each mistake a person can make along the way | It works as a person would use it |
| A film of three sheets played to the browser as its camera | Scanning works end to end: one library draws the code, another reads it |
| Sets from the barest to the fullest a sheet can be, with the longest names, laid out for A4 and US Letter in three different fonts, then pictured and read back | Each sheet fits on one page whatever fonts the device has, no line is cut off, and it still scans |
| The page's requests are counted, and a script is made to try fetching, loading a picture, adding a script and opening a frame | It asks for nothing, and its security policy refuses each of those |
| Automated accessibility checks on every screen, and a set made, proved and recovered with the keyboard alone | No barriers that a machine can detect, and no need for a mouse |

That is 251 Python tests, 74 tests of the web version's core and 39 in the
browser. All of them, and the three cross-checks between the versions, run
on GitHub with every change.

## Try it

**The web page.** Go to <https://hermit005-io.github.io/secret-sheets/>, or open `docs/index.html`. Nothing else
is needed.

**The Python version.** You need Python 3.10 or newer.

macOS (Terminal):

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Windows (PowerShell):

```powershell
py -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

Then:

```bash
python -m secretsheets split --needed 3 --total 5 --label "Email recovery codes"
python -m secretsheets recover sheets/sheet-1.txt sheets/sheet-3.txt sheets/sheet-5.txt
python -m secretsheets check sheets/sheet-2.txt
pytest
```

`split` asks for the secret (twice, hidden) and writes one text file per
sheet into `sheets/`. On macOS and Linux only you can read them. Add
`--owner "Your name"` and `--names "Ama, Kofi, Esi, Yaw, Abena"` to print
who each sheet is from and for. A sheet made here can be typed into the web
page, and a sheet printed by the web page can be typed into a file and
recovered here.

**Rebuilding the web page.** Needs Node 22.18 or newer.

```bash
cd web
npm ci
npm run build       # writes docs/index.html
npm test            # the core, against the published test cases
npx playwright install chromium
npm run e2e         # the page, in a real browser
```

The build is repeatable: the same source gives the same file, byte for byte,
and GitHub checks that `docs/index.html` is exactly what the source builds.

## Honest scope

The full list of what can go wrong, the safeguard for each, and what still
remains is in [RISKS.md](RISKS.md). The short version:

- **Not professionally audited.** The splitting library in the web page has
  been. This project's own code has not.
- **It cannot protect against the device it runs on.** If the phone or
  computer used to split or recover is infected, the secret can be read
  there. The page's security policy stops it loading or fetching anything,
  but no page can stop a browser extension, or the browser itself.
- **It cannot protect against people.** If enough holders agree to combine
  their sheets without you, they can. Choosing them is up to you.
- **Nothing is stored anywhere.** Lose more sheets than your rule allows and
  the secret is gone. Nobody, including me, can get it back.
- **Old sheets keep working.** If the secret changes, make a new set and ask
  for the old sheets back. Paper cannot be recalled.
- **Short secrets only.** Up to 510 bytes: passwords, codes, a short note.
- **Scanning has had one real test so far.** A 3-of-5 set printed on an HP
  printer was read back, all five sheets, by a MacBook's camera in Chrome,
  and the secret returned. Beyond that it has been tested with a simulated
  camera and pictures of the print layout, not yet on phones, in other
  browsers, or with other printers and lighting. Typing always works.
- **No test with real people yet.** Whether someone who has never seen it can
  split and recover unaided is the next thing to measure, and the results
  will be published here whatever they are.
- **Neither JavaScript nor Python can wipe memory** or promise that every
  operation takes the same time.
- **Not legal advice, and not a will.** Who may lawfully use a person's
  accounts differs by country and by service.

## Layout

```
docs/index.html     the web page, built: the one file people use
SPEC.md             the sheet format, in full
RISKS.md            what can go wrong, and what is done about it
secretsheets/       the Python version
  field.py            arithmetic on bytes as a field of 256 elements
  shamir.py           splitting a key into pieces and rebuilding it
  locking.py          padding and encrypting the secret
  sheet.py            what is on a sheet, and its layout in bytes
  written.py          the QR text and the typed lines, with their checks
  core.py             making a set, recovering, checking a sheet
  errors.py           the named ways a sheet can be wrong
  page.py, cli.py     the printed words, and the commands
web/                the web version (TypeScript)
  src/                the same modules, plus the screens in src/ui
  tests/              the core, against the published test cases
  e2e/                the page in a real browser
  scripts/            used by the cross-check with the Python version
  build.mjs           builds everything into the one HTML file
tests/              the Python tests, and tests/vectors shared by both versions
tools/              the cross-checks between Python, the web version and the library
```

## License

MIT. See [LICENSE](LICENSE). The web page includes three open-source
libraries under their own licences: see
[THIRD-PARTY-LICENSES.md](THIRD-PARTY-LICENSES.md).
