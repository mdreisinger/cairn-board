// Apply the DryRunBackend's recorded commits to a copy of cairn-shaped invented data, then run the data repo's real bin/lint.sh.
import test from "node:test";
import assert from "node:assert/strict";
import { Board } from "../../js/board.js";
import { DryRunBackend } from "../../js/backends/dryrun.js";
import { planMove, planAddTodo } from "../../js/model.js";
import { fixtureFiles } from "../../sandbox/fixture.js";
import { SKIP, writeTree, cleanup, runLint } from "./helpers.mjs";

test("board edits keep the repo valid: lint.sh reports 0 errors after replaying recorded commits", { skip: SKIP }, async () => {
  const start = fixtureFiles();
  const copy = writeTree(start);
  try {
    const base = runLint(copy);
    assert.equal(base.code, 0, base.out);
    const backend = new DryRunBackend(start);
    const board = new Board(backend);
    const act = async (mk) => {
      const snap = await board.load();
      const plan = mk(snap.files);
      assert.equal(plan.kind, "ok", JSON.stringify(plan));
      await board.commit(plan, snap);
    };
    const today = "2026-10-31";
    await act((f) => planAddTodo(f, "Sweep the porch", { today }));
    await act((f) => planMove(f, "s:garden-shed", "waiting", { today, who: "Dana" }));
    await act((f) => planMove(f, "s:garden-shed", "progress", { today }));
    await act((f) => planMove(f, "s:kitchen-quote", "parked", { today }));
    await act((f) => planMove(f, "s:book-club", "done", { today }));
    await act((f) => planMove(f, "s:old-bike", "progress", { today }));
    await act((f) => planMove(f, "t:t-demo-1", "waiting", { today, who: "Kim" }));
    await backend.externalCommit(); // not applied: not a board commit
    const rec = backend.recorded.filter((r) => !r.external);
    assert.equal(rec.length, 7);
    for (const r of rec) writeTree(Object.fromEntries(r.files.map((f) => [f.path, f.text])), copy);
    const after = runLint(copy);
    assert.equal(after.code, 0, after.out);
    assert.match(after.out, /lint: 0 error\(s\)/);
    console.log(`# replayed ${rec.length} recorded commits touching ${[...new Set(rec.flatMap((r) => r.files.map((f) => f.path)))].join(", ")}; ${after.out.trim()}`);
  } finally {
    cleanup(copy);
  }
});
