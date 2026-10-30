# cairn-board

A phone-first board (lanes and a to-do add) for a private notes repo, installable as a Home Screen web app. This repo is code only and holds no data. See [SPEC.md](SPEC.md).

- Plain HTML, CSS and JS modules. No build step, no third-party scripts.
- Open the page, enter your repo's owner, name and a fine-grained token (Contents: read and write on that one repo). They are stored in this browser's localStorage and nowhere else.
- Add `?sandbox=1` to try it on invented data with no token. A dry-run backend records the commits it would make.

Tests: `node --test "tests/unit/*.test.mjs"` runs the unit tests (some compare against the data repo's `bin/lint.py` and `bin/scan-secrets.py` when `CAIRN_DIR` points at a checkout). `tests/browser/run.mjs` drives the sandbox in a headless browser.
