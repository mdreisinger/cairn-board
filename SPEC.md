# cairn-board spec (Gate 3, v1)

A phone-first board for a private notes repo ("cairn"), installed as a Home Screen web app. This public repo holds code only. The data repo's owner, name and a fine-grained token are entered on the setup screen and kept in the browser's localStorage. Scope is lanes and a to-do add. Nothing else is in v1: no drawer, Day view, find, keys, undo or Sessions lane.

## What it does

- Reads the data repo's `streams/*.md` and `board.json` through the GitHub API and shows each stream and each to-do as a card in one of five lanes: Backlog, In progress, Waiting on others, Parked, Done.
- Lets the user add a to-do (lands in Backlog) and move any card to another lane with a per-card control that works by touch.
- Writes each action as one commit on the data repo's branch through the Git Data API, so a stream and its INDEX row change together. It never forces.
- Works with no network access to GitHub in sandbox mode (`?sandbox=1`), which uses an in-memory dry-run backend over invented fixture data and records every commit it would have made.

## Lane rules

- A card has one stage: backlog, active, paused, done or abandoned. Streams use the status on line 2 of the file; to-dos carry `stage` in `board.json`.
- active with Ball `me` or `none` is In progress. active with Ball `<who> since <date>` is Waiting on others, grouped by who. paused is Parked. done and abandoned are Done (cards updated in the last 30 days; an "Older: N" button shows the rest). backlog is Backlog and is only possible for to-dos.
- A stream can't move to Backlog: "It has already started; park it instead."
- Moving to Waiting asks "On whom?" unless the card already names someone in its Ball. Moving to In progress sets Ball to `me`. Moving to Done sets Ball to `none`. Moving to Parked leaves Ball as it is.
- A move on a stream sets `updated:` to today's local date.

## What may be written (STANDARDS section 4, Board row)

A stream's line 1 and line 2, its one `**Ball:**` line, `board.json`, and the INDEX row generated from them. In v1 only line 2 (status, updated) and the Ball line of a stream change. Every other byte of a stream file is preserved. INDEX.md is regenerated with the same logic as the data repo's `bin/lint.py` so lint stays clean.

## Safety rules

- Strict CSP in a meta tag, no inline script, no third-party script. Repo text is rendered with `textContent` only.
- Before writing, the board runs the same secret patterns as the data repo's `bin/scan-secrets.py` (ported to JS) over the lines it would add, and refuses with a masked message on a hit.
- A stale write (the branch moved since the board last read, or a 409/422 on the ref update) is not saved. The board shows "Not saved" with Retry. Retry re-reads and re-applies the move only if the card is still where the user saw it.
- If `board.json` is missing or damaged the whole board opens read-only with a banner and never creates or overwrites it.
- 401, 403 and rate-limit responses show a clear message.
- The token is never logged, put in a URL or shown back.

## Acceptance list

1. The page loads with no inline script and a CSP of `default-src 'none'`, with `connect-src` limited to `https://api.github.com`. A real-browser run records zero CSP violations and no request to any host but localhost.
2. First run shows a setup screen asking for owner, repo, branch and a token (password field). It states exactly what is stored and where. Sign-out clears it and returns to setup. With localStorage unavailable the board says so and keeps the values in memory only.
3. `?sandbox=1` requests no token, shows a visible SANDBOX banner, uses the dry-run backend and makes no call to api.github.com.
4. Lanes appear left to right (one column of sections on a phone): Backlog, In progress, Waiting on others, Parked, Done. Streams and to-dos land in the lane the mapping above gives, and Waiting is grouped by who.
5. Adding a to-do writes one commit that changes only `board.json`, and the card appears in Backlog.
6. Moving a card to Waiting asks "On whom?" when nobody is named, then writes `<who> since <today>`. Moving to In progress writes Ball `me`. Both set `updated:` on a stream.
7. Moving a stream to Backlog is refused with the message above and writes nothing.
8. A stream move changes only line 2 and the Ball line of that file, byte for byte elsewhere, plus INDEX.md, in a single commit.
9. The JS INDEX generator and the data repo's `bin/lint.py` produce identical INDEX.md bytes on the same fixtures, including ordering.
10. The JS secret scanner and `bin/scan-secrets.py` agree on shared fixtures. A to-do containing a secret shape is refused with a masked message and nothing is written.
11. A stale write shows "Not saved" with Retry and never forces. The ref update always sends `force: false`.
12. Missing or damaged `board.json` opens the board read-only with a banner and no write is attempted.
13. Rate-limit and 401 responses show a clear message that says what to do.
14. Reads are never served from a stale cache: the branch head is re-read with a conditional request (ETag) on every refresh and poll, and content is cached only by blob sha.
15. The layout has no horizontal scroll at phone width, respects safe-area insets and follows light and dark mode.
16. The page is installable to the Home Screen (manifest, icons, Apple meta tags).
17. Applying the dry-run backend's recorded commits to a copy of cairn-shaped fixture data leaves the data repo's `bin/lint.sh` at 0 errors.
18. The public repo contains no personal data, no private repo content and no token.

## Out of scope

Drawer, Day view, find, keyboard shortcuts, undo, Sessions lane, drag and drop, bulk actions, rename, priority, plan dates, notifications, offline use. A service worker is not used: Home Screen install does not need one, and nothing may be cached that could go stale.
