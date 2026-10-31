import test from "node:test";
import assert from "node:assert/strict";
import { Board } from "../../js/board.js";
import { DryRunBackend } from "../../js/backends/dryrun.js";
import { BoardError, notSaved } from "../../js/errors.js";
import { planMove, planAddTodo, buildCards } from "../../js/model.js";
import { fixtureFiles } from "../../sandbox/fixture.js";
import { POSITIVES } from "./helpers.mjs";

const TODAY = "2026-10-30";
const setup = () => {
  const backend = new DryRunBackend(fixtureFiles());
  return { backend, board: new Board(backend) };
};

test("one commit per action: stream and its INDEX row change together; parent is the old head", async () => {
  const { backend, board } = setup();
  const snap = await board.load();
  const plan = planMove(snap.files, "s:garden-shed", "waiting", { today: TODAY, who: "Dana" });
  const next = await board.commit(plan, snap);
  assert.equal(backend.recorded.length, 1);
  const rec = backend.recorded[0];
  assert.equal(rec.parent, snap.head);
  assert.equal(rec.sha, next.head);
  assert.deepEqual(rec.files.map((f) => f.path).sort(), ["INDEX.md", "streams/garden-shed.md"]);
  assert.equal(backend.head, next.head);
  const again = await board.load();
  assert.ok(again.files.get("streams/garden-shed.md").includes("**Ball:** Dana since 2026-10-30"));
  assert.equal(buildCards(again.files).cards.find((c) => c.id === "s:garden-shed").lane, "waiting");
});

test("add to-do commits only board.json", async () => {
  const { backend, board } = setup();
  const snap = await board.load();
  await board.commit(planAddTodo(snap.files, "Water the plants", { today: TODAY }), snap);
  assert.deepEqual(backend.recorded[0].files.map((f) => f.path), ["board.json"]);
});

test("stale write is refused: Not saved, nothing recorded, ref untouched, never forced", async () => {
  const { backend, board } = setup();
  const snap = await board.load();
  await backend.externalCommit();
  const headAfterOther = backend.head;
  const plan = planMove(snap.files, "s:garden-shed", "parked", { today: TODAY });
  await assert.rejects(board.commit(plan, snap), (e) => {
    assert.ok(e instanceof BoardError);
    assert.equal(e.kind, "conflict");
    assert.match(notSaved(e), /^Not saved\./);
    return true;
  });
  assert.equal(backend.head, headAfterOther);
  assert.deepEqual(backend.recorded.filter((r) => !r.external), []);
});

test("race between reading the ref and updating it: the backend refuses the non-fast-forward", async () => {
  const { backend, board } = setup();
  const snap = await board.load();
  const realCreate = backend.createCommit.bind(backend);
  backend.createCommit = async (...a) => {
    const sha = await realCreate(...a);
    await backend.externalCommit(); // someone else lands after our commit object exists
    return sha;
  };
  const plan = planMove(snap.files, "s:garden-shed", "parked", { today: TODAY });
  await assert.rejects(board.commit(plan, snap), (e) => e.kind === "conflict" && e.status === 422);
  assert.deepEqual(backend.recorded.filter((r) => !r.external), []);
});

test("retry after a stale write succeeds once the board has reloaded", async () => {
  const { backend, board } = setup();
  let snap = await board.load();
  await backend.externalCommit();
  await assert.rejects(board.commit(planMove(snap.files, "s:garden-shed", "parked", { today: TODAY }), snap));
  snap = await board.load();
  const next = await board.commit(planMove(snap.files, "s:garden-shed", "parked", { today: TODAY }), snap);
  assert.equal(backend.head, next.head);
  assert.equal(backend.recorded.filter((r) => !r.external).length, 1);
});

test("a secret shape in a to-do is saved, because the scan is off", async () => {
  const { backend, board } = setup();
  const snap = await board.load();
  const plan = planAddTodo(snap.files, `call back ${POSITIVES[0][1]} soon`, { today: TODAY });
  assert.equal(plan.kind, "ok");
  await board.commit(plan, snap);
  assert.equal(backend.recorded.length, 1);
});

test("damaged board.json: load works, view is read-only, no write path produces a plan", async () => {
  const files = { ...fixtureFiles(), "board.json": "{ broken" };
  const backend = new DryRunBackend(files);
  const board = new Board(backend);
  const snap = await board.load();
  const view = buildCards(snap.files);
  assert.equal(view.board.state, "damaged");
  assert.equal(planAddTodo(snap.files, "x", { today: TODAY }).kind, "error");
  assert.equal(planMove(snap.files, "t:t-demo-1", "parked", { today: TODAY }).kind, "error");
  assert.equal(backend.recorded.length, 0);
  assert.equal(backend.snapshotFiles()["board.json"], "{ broken");
});

test("missing board.json is never created", async () => {
  const files = fixtureFiles();
  delete files["board.json"];
  const backend = new DryRunBackend(files);
  const board = new Board(backend);
  const snap = await board.load();
  assert.equal(buildCards(snap.files).board.state, "missing");
  assert.equal(planAddTodo(snap.files, "x", { today: TODAY }).kind, "error");
  assert.ok(!("board.json" in backend.snapshotFiles()));
});
