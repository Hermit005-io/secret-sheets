# What can go wrong

This is the tool's own list of the ways it can fail, the safeguard against
each, and what remains after the safeguard. The last column matters most: it
says what the tool does not protect against, so that nobody relies on it for
more than it does.

| What can go wrong | Safeguard | What still remains |
| --- | --- | --- |
| Too many holders lose their sheet or cannot be reached | The page explains the choice of rule in terms of how many sheets can be lost. "Check a sheet" lets losses be found early | If fewer sheets survive than the rule needs, the secret is gone. That is the design, not a fault |
| Enough holders combine their sheets without the owner's consent | The owner chooses the people and the number, and the page says how many would have to agree | This is a matter of trust in people. No software changes it |
| A sheet is faded, torn or mistyped | Error correction in the QR code, a check on every typed line, a fingerprint for every piece | A sheet destroyed outright counts as lost |
| A sheet is replaced or altered | Its piece no longer matches its fingerprint, or its Part A no longer matches the other sheets'. Either way it is refused | A sheet whose Part A differs is not blamed: the page says only that it does not match the first one added, because either could be the altered one. Given all the sheets at once, the Python version names the odd one out when most agree |
| Every sheet presented has been altered in the same way | The encryption refuses: the details of the set are bound to the locked secret | Nothing is recovered from those sheets. Honest sheets held by others still work |
| Someone photographs one sheet | The pieces on fewer sheets than the rule needs reveal nothing about the key. The rest of the sheet (the locked secret, and the fingerprints of the other pieces) is protected by AES-256 and SHA-256 | The sheet does show the label, the date, the rule and roughly how long the secret is. A break of either algorithm would weaken this |
| The device used to split or recover is infected | The page works offline, on a device the person chooses | Software cannot defend against the device it runs on |
| A fake copy of the page | The page is one file, its build is repeatable and its source is public, so a copy can be compared with the real one. The Python version reads the same sheets | A person who never checks is exposed to a convincing fake |
| The page is tampered with after it loads | The page's security policy allows only the script built into it, so an injected script cannot run, and it lets the page load and fetch nothing | The policy cannot stop a page being sent to another address, so it would not contain a fault in the script built into the page itself. A malicious browser extension is outside the page's control |
| Weak random numbers | Only the operating system's secure generator is used, and the tool stops without it | A broken operating system or browser |
| A mistake in this project's own code | An audited library does the splitting in the web page; a second independent version must agree with it; the arithmetic is tested for every input; the test cases are published | Bugs no test has found. The project has not had a professional audit |
| The secret changes later | Every set carries a date and a set code, so old and new sheets can be told apart | Old sheets still open the old secret. Paper cannot be recalled |
| The printer or a saved PDF keeps a copy | The page says to delete a saved PDF. A sheet can also be copied out by hand from its typed lines | Depends on the printer |
| A sheet runs onto a second page, and half of it is lost | The page measures the sheets on the device and picks the largest type at which each fits on one page. A part is never split between pages, and Part B says which sheet it belongs to | On a device whose letters are unusually wide, the very fullest sheet could still need a second page |
| The page is left by accident before the sheets are finished | Going back, reloading or closing asks first | A second press is taken at its word |
| The sheets are handed out without ever being tried | The page asks for the printed sheets to be read back first, and finishing without doing so takes a second, deliberate press | A person can still press twice |
| A holder, years later, cannot find the tool | Each sheet says what it is, what to do and, if the owner gave a name, who it is from. It names the page and gives its address | If the address ever stops working, the holder needs a saved copy of the page, the Python version, or someone who can rebuild from SPEC.md |
| The project's website disappears | The page works as a saved file, the format is written down in SPEC.md, and the Python version needs no website | Someone must still have one of them |
| The browser keeps what was typed | Nothing is written to storage, cookies or the address bar, and "Finish and clear" empties the page | Neither JavaScript nor Python can guarantee memory is wiped. Close the tab when done |

## What a sheet reveals

To anyone who reads it, one sheet shows: the label, the date the set was
made, how many sheets there are and how many are needed, which sheet it is,
and the size of the secret rounded up to 62, 126, 254 or 510 bytes. If the
owner chose to print them, it also shows their name and the holder's.
Nothing else about the secret can be learned from fewer sheets than the rule
needs without breaking AES-256 or SHA-256.

## Reporting a problem

If you find a way to recover a secret from too few sheets, to make the tool
show a wrong secret, or to make the page send anything anywhere, please open
an issue on the project's repository.
