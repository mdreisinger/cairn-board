// JS ports must agree with the data repo's own Python: INDEX generator (bin/lint.py) and scanner (bin/scan-secrets.py).
import test from "node:test";
import assert from "node:assert/strict";
import { generateIndex, planMove } from "../../js/model.js";
import { scanLine, addedLines } from "../../js/scan.js";
import { fixtureFiles } from "../../sandbox/fixture.js";
import { SKIP, writeTree, cleanup, pythonIndex, pythonScan, runLint, POSITIVES, NEGATIVES } from "./helpers.mjs";

const AREAS = "# Areas\n\n- home — House\n- money — Money\n- travel — Trips\n- learning — Reading\n- system — Tooling\n";
const stream = (title, line2, now) => `# ${title}\n${line2}\nWhere: -\n\n## Now\n${now}\n\n## Log\n### 2026-10-01 · note · x\n- y\n`;
const NASTY = {
  "streams/pipes.md": stream("Pipes", "status: active · updated: 2026-10-29 · area: home", "**Goal:** g\n**State:** a | b | c\n**Next:**\n- x | y\n**Waiting on / blocked by:** nothing\n**Ball:** me\n**Key decisions:** d"),
  "streams/multi.md": stream("Multi", "status: paused · updated: 2026-10-29 · area: home", "**Goal:** g\n**State:** first line\n  second   line\twith    spaces\n\nthird after blank\n**Next:**\nnot a bullet first\n- real bullet\n**Waiting on / blocked by:** nothing\n**Ball:** none\n**Key decisions:** d"),
  "streams/empty.md": stream("Empty", "status: active · updated: 2026-10-29 · area: money", "**Goal:** g\n**State:**\n**Next:**\n**Waiting on / blocked by:** nothing\n**Ball:** me\n**Key decisions:** d"),
  "streams/unicode.md": stream("Ünï", "status: active · updated: 2026-10-28 · area: travel", "**Goal:** g\n**State:** " + "é→日本".repeat(70) + "\n**Next:**\n- " + "ñ".repeat(150) + "\n**Waiting on / blocked by:** nothing\n**Ball:** me\n**Key decisions:** d"),
  "streams/crlf.md": stream("Crlf", "status: active · updated: 2026-10-28 · area: home", "**Goal:** g\n**State:** crlf state\n**Next:**\n- crlf next\n**Waiting on / blocked by:** nothing\n**Ball:** me\n**Key decisions:** d").replace(/\n/g, "\r\n"),
  "streams/no-now.md": "# No now\nstatus: active · updated: 2026-10-27 · area: home\n",
  "streams/bad-line2.md": "# Bad\nstatus active\n## Now\n",
  "streams/a.md": stream("A", "status: active · updated: 2026-10-26 · area: home", "**Goal:** g\n**State:** s\n**Next:**\n- n\n**Waiting on / blocked by:** nothing\n**Ball:** me\n**Key decisions:** d"),
  "streams/a-b.md": stream("AB", "status: active · updated: 2026-10-26 · area: home", "**Goal:** g\n**State:** s2\n**Next:**\n- n2\n**Waiting on / blocked by:** nothing\n**Ball:** me\n**Key decisions:** d"),
};

function treeFor(files) {
  return writeTree({ ...files, "areas.md": AREAS });
}

test("INDEX: JS generator equals bin/lint.py on the fixture and on nasty cases", { skip: SKIP }, () => {
  for (const files of [fixtureFiles(), { ...fixtureFiles(), ...NASTY }, NASTY, {}]) {
    const dir = treeFor(files);
    try {
      assert.equal(generateIndex(files), pythonIndex(dir));
    } finally {
      cleanup(dir);
    }
  }
});

test("INDEX ordering: newest date first, same-date ties by slug (a before a-b, trip before trip-prep)", { skip: SKIP }, () => {
  const idx = generateIndex({ ...fixtureFiles(), ...NASTY });
  const rows = idx.split("\n").filter((l) => l.startsWith("| ["));
  const slugs = rows.map((r) => r.match(/\[(.+?)\]/)[1]);
  assert.ok(slugs.indexOf("a") < slugs.indexOf("a-b"));
  assert.ok(slugs.indexOf("trip") < slugs.indexOf("trip-prep"));
  const dates = rows.map((r) => r.split(" | ")[2]);
  assert.deepEqual(dates, [...dates].sort().reverse());
});

test("INDEX after every kind of move still equals bin/lint.py", { skip: SKIP }, () => {
  const base = new Map(Object.entries({ ...fixtureFiles(), ...NASTY }));
  base.set("INDEX.md", generateIndex(base));
  for (const [card, to] of [["s:kitchen-quote", "progress"], ["s:book-club", "waiting"], ["s:book-club", "parked"], ["s:book-club", "done"]]) {
    const p = planMove(base, card, to, { today: "2026-10-31", who: "Dana" });
    assert.equal(p.kind, "ok", to);
    const next = new Map(base);
    for (const c of p.changes) next.set(c.path, c.text);
    const dir = treeFor(Object.fromEntries(next));
    try {
      assert.equal(next.get("INDEX.md"), pythonIndex(dir), to);
    } finally {
      cleanup(dir);
    }
  }
});

test("scanner: JS agrees with bin/scan-secrets.py on assembled positives, negatives and mixed lines", { skip: SKIP }, () => {
  const lines = [...POSITIVES.map((p) => p[1]), ...NEGATIVES];
  // Wrap each positive in surrounding text and JSON, the way board.json would hold it.
  for (const [, v] of POSITIVES) {
    lines.push(`  "title": "note ${v} end",`, `Reply to Robin: ${v}`, `${v}`.toUpperCase(), `x ${v.slice(0, 12)}`);
  }
  const py = pythonScan(lines);
  lines.forEach((l, i) => {
    assert.deepEqual(scanLine(l).map((h) => [h[0], h[1]]), py[i], `line ${i}`);
  });
});

test("scanner: every positive is detected by JS with the expected rule", () => {
  for (const [rule, text] of POSITIVES) assert.ok(scanLine(text).some((h) => h[0] === rule), rule + " missed");
  for (const text of NEGATIVES) assert.deepEqual(scanLine(text), [], text);
});

test("addedLines is a multiset difference", () => {
  assert.deepEqual(addedLines("a\nb\nb\n", "a\nb\nb\nc\nb\n"), ["c", "b"]);
});
