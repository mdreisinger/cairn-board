import test from "node:test";
import assert from "node:assert/strict";
import { laneFor, parseBall, buildCards, planMove, planAddTodo, editStream, parseBoard, BACKLOG_REFUSAL, addDays, todayLocal } from "../../js/model.js";
import { fixtureFiles } from "../../sandbox/fixture.js";

const files = () => new Map(Object.entries(fixtureFiles()));
const TODAY = "2026-10-30";

test("lane mapping from stage and Ball", () => {
  assert.equal(laneFor("backlog", parseBall("none")), "backlog");
  assert.equal(laneFor("active", parseBall("me")), "progress");
  assert.equal(laneFor("active", parseBall("none")), "progress");
  assert.equal(laneFor("active", parseBall("")), "progress");
  assert.equal(laneFor("active", parseBall("Pat since 2026-10-20")), "waiting");
  assert.equal(laneFor("paused", parseBall("Pat since 2026-10-20")), "parked");
  assert.equal(laneFor("done", parseBall("none")), "done");
  assert.equal(laneFor("abandoned", parseBall("me")), "done");
});

test("fixture cards land in the expected lanes", () => {
  const { cards, skipped } = buildCards(files());
  assert.equal(skipped, 0);
  const lane = (id) => cards.find((c) => c.id === id).lane;
  assert.equal(lane("s:garden-shed"), "progress");
  assert.equal(lane("s:book-club"), "progress");
  assert.equal(lane("s:kitchen-quote"), "waiting");
  assert.equal(lane("s:tax-folder"), "waiting");
  assert.equal(lane("s:trip-prep"), "parked");
  assert.equal(lane("s:old-bike"), "done");
  assert.equal(lane("t:t-demo-1"), "backlog");
  assert.equal(lane("t:t-demo-2"), "progress");
  assert.equal(lane("t:t-demo-3"), "waiting");
});

test("stream edit changes only line 2 status/updated and the Ball line, byte for byte elsewhere", () => {
  const f = files();
  const before = f.get("streams/garden-shed.md");
  const after = editStream(before, { status: "paused", updated: TODAY, ball: "Pat since 2026-10-30" });
  const a = before.split("\n");
  const b = after.split("\n");
  assert.equal(a.length, b.length);
  const changed = a.map((l, i) => (l === b[i] ? -1 : i)).filter((i) => i >= 0);
  assert.equal(changed.length, 2);
  assert.equal(a[changed[0]].startsWith("status: "), true);
  assert.equal(b[changed[0]], `status: paused · updated: ${TODAY} · area: home`);
  assert.equal(a[changed[1]], "**Ball:** me");
  assert.equal(b[changed[1]], "**Ball:** Pat since 2026-10-30");
  // a no-op edit is the identity
  assert.equal(editStream(before, {}), before);
});

test("stream edit keeps CRLF endings and refuses damaged files", () => {
  const crlf = fixtureFiles()["streams/garden-shed.md"].replace(/\n/g, "\r\n");
  const out = editStream(crlf, { status: "done", updated: TODAY, ball: "none" });
  assert.equal(out.split("\r\n").length, crlf.split("\r\n").length);
  assert.ok(out.includes(`status: done · updated: ${TODAY} · area: home\r\n`));
  assert.ok(out.includes("**Ball:** none\r\n"));
  const noBall = fixtureFiles()["streams/garden-shed.md"].replace("**Ball:** me\n", "");
  assert.throws(() => editStream(noBall, { status: "done" }), /Ball/);
  const two = fixtureFiles()["streams/garden-shed.md"].replace("**Ball:** me\n", "**Ball:** me\n**Ball:** none\n");
  assert.throws(() => editStream(two, { status: "done" }), /Ball/);
  assert.throws(() => editStream("# T\nbroken line\n## Now\n**Ball:** me\n", { status: "done" }), /line 2/);
});

test("planMove: stream to Backlog is refused; nothing planned", () => {
  const p = planMove(files(), "s:garden-shed", "backlog", { today: TODAY });
  assert.equal(p.kind, "refused");
  assert.equal(p.reason, BACKLOG_REFUSAL);
  assert.equal(BACKLOG_REFUSAL, "It has already started; park it instead.");
});

test("planMove: Waiting asks for a name unless one is on the card", () => {
  let p = planMove(files(), "s:garden-shed", "waiting", { today: TODAY });
  assert.equal(p.kind, "needs-who");
  p = planMove(files(), "s:garden-shed", "waiting", { today: TODAY, who: "  Dana   Ng " });
  assert.equal(p.kind, "ok");
  const stream = p.changes.find((c) => c.path === "streams/garden-shed.md").text;
  assert.ok(stream.includes("**Ball:** Dana Ng since 2026-10-30"));
  assert.ok(stream.includes("status: active · updated: 2026-10-30 · area: home"));
  assert.ok(p.changes.some((c) => c.path === "INDEX.md"));
  // parked stream that already names someone: no question, Ball line kept
  p = planMove(files(), "s:trip-prep", "waiting", { today: TODAY });
  assert.equal(p.kind, "ok");
  assert.ok(p.changes[0].text.includes("**Ball:** Sam since 2026-10-08"));
  assert.equal(planMove(files(), "s:garden-shed", "waiting", { today: TODAY, who: "me" }).kind, "needs-who");
});

test("planMove: In progress sets Ball to me and updated to today", () => {
  const p = planMove(files(), "s:kitchen-quote", "progress", { today: TODAY });
  assert.equal(p.kind, "ok");
  const t = p.changes.find((c) => c.path === "streams/kitchen-quote.md").text;
  assert.ok(t.includes("**Ball:** me\n"));
  assert.ok(t.includes("updated: 2026-10-30"));
});

test("planMove: parked keeps Ball, done sets Ball none; same lane is a no-op", () => {
  let p = planMove(files(), "s:kitchen-quote", "parked", { today: TODAY });
  assert.ok(p.changes[0].text.includes("**Ball:** Pat since 2026-10-20"));
  p = planMove(files(), "s:kitchen-quote", "done", { today: TODAY });
  assert.ok(p.changes[0].text.includes("**Ball:** none"));
  assert.equal(planMove(files(), "s:garden-shed", "progress", { today: TODAY }).kind, "noop");
});

test("planMove on a to-do changes only board.json and may use Backlog", () => {
  let p = planMove(files(), "t:t-demo-2", "backlog", { today: TODAY });
  assert.equal(p.kind, "ok");
  assert.deepEqual(p.changes.map((c) => c.path), ["board.json"]);
  const t = JSON.parse(p.changes[0].text).todos.find((x) => x.id === "t-demo-2");
  assert.equal(t.stage, "backlog");
  assert.equal(t.updated, TODAY);
  p = planMove(files(), "t:t-demo-1", "waiting", { today: TODAY, who: "Kim" });
  assert.equal(JSON.parse(p.changes[0].text).todos.find((x) => x.id === "t-demo-1").ball, "Kim since 2026-10-30");
});

test("planAddTodo appends a backlog to-do and nothing else", () => {
  const p = planAddTodo(files(), "  Paint   the fence ", { today: TODAY, now: new Date(2026, 9, 30, 12), rand: () => 0.5 });
  assert.equal(p.kind, "ok");
  assert.deepEqual(p.changes.map((c) => c.path), ["board.json"]);
  const d = JSON.parse(p.changes[0].text);
  assert.equal(d.todos.length, 4);
  assert.deepEqual({ ...d.todos[3], id: "x" }, { id: "x", title: "Paint the fence", stage: "backlog", ball: "none", created: TODAY, updated: TODAY });
  assert.equal(planAddTodo(files(), "   ", { today: TODAY }).kind, "error");
});

test("damaged or missing board.json: read-only, plans refuse, nothing is created", () => {
  for (const bad of [undefined, "{nope", '{"version":2,"todos":[]}', '{"version":1,"todos":[{"id":"a"}]}', "[]"]) {
    const f = files();
    if (bad === undefined) f.delete("board.json");
    else f.set("board.json", bad);
    const view = buildCards(f);
    assert.notEqual(view.board.state, "ok");
    assert.equal(planAddTodo(f, "x", { today: TODAY }).kind, "error");
    assert.equal(planMove(f, "s:garden-shed", "parked", { today: TODAY }).kind, "error");
  }
  assert.equal(parseBoard(undefined).state, "missing");
  assert.equal(parseBoard("{nope").state, "damaged");
  assert.equal(parseBoard('{"version":1,"todos":[]}').state, "ok");
});

test("dates", () => {
  assert.equal(todayLocal(new Date(2026, 0, 5)), "2026-01-05");
  assert.equal(addDays("2026-03-01", -1), "2026-02-28");
});
