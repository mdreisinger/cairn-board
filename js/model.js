// Pure data logic: stream parsing, lanes, edits, INDEX generation, board.json. No DOM, no network.

export const LANES = [
  { id: "backlog", label: "Backlog" },
  { id: "progress", label: "In progress" },
  { id: "waiting", label: "Waiting on others" },
  { id: "parked", label: "Parked" },
  { id: "done", label: "Done" },
];
export const STAGES = ["backlog", "active", "paused", "done", "abandoned"];
export const STREAM_STATUS = ["active", "paused", "done", "abandoned"];
export const BACKLOG_REFUSAL = "It has already started; park it instead.";

// Ported from bin/lint.py. Keep in step.
const LINE2 = /^status: (\S+) · updated: (\S+) · area: (\S+)$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const INDEX_HEADER = ["# Index", "", "| Stream | Status | Updated | State → next |", "| --- | --- | --- | --- |"];
const BALL_WHO = /^(.+?) since (\d{4}-\d{2}-\d{2})$/;

export function realDate(s) {
  if (!DATE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function todayLocal(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function addDays(iso, delta) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

// ---- Ball ----
// Returns {kind: "me"|"none"|"who", who, since}
export function parseBall(raw) {
  const v = (raw || "").trim();
  if (v === "" || v.toLowerCase() === "me") return { kind: "me", who: null, since: null };
  if (v.toLowerCase() === "none") return { kind: "none", who: null, since: null };
  const m = BALL_WHO.exec(v);
  if (m) return { kind: "who", who: m[1].trim(), since: m[2] };
  return { kind: "who", who: v, since: null };
}

export function laneFor(stage, ball) {
  if (stage === "backlog") return "backlog";
  if (stage === "paused") return "parked";
  if (stage === "done" || stage === "abandoned") return "done";
  if (stage === "active") return ball.kind === "who" ? "waiting" : "progress";
  return null;
}

// ---- stream text ----
function splitLines(text) {
  return text.split("\n");
}

function nowRange(lines) {
  const a = lines.findIndex((l) => l.trim() === "## Now");
  if (a < 0) return null;
  let b = lines.length;
  for (let i = a + 1; i < lines.length; i++) {
    if (lines[i].startsWith("## ")) {
      b = i;
      break;
    }
  }
  return [a + 1, b];
}

function stripCR(l) {
  return l.endsWith("\r") ? [l.slice(0, -1), "\r"] : [l, ""];
}

export function parseStream(slug, rawText) {
  const text = rawText.replace(/\r\n/g, "\n");
  const lines = splitLines(text);
  const title = lines[0] && lines[0].startsWith("# ") ? lines[0].slice(2).trim() : null;
  const m = lines.length > 1 ? LINE2.exec(lines[1]) : null;
  if (!m) return { ok: false, slug, title };
  const range = nowRange(lines);
  const block = range ? lines.slice(range[0], range[1]) : [];
  const ballLines = block.filter((l) => l.startsWith("**Ball:**"));
  const ball = parseBall(ballLines.length ? ballLines[0].slice("**Ball:**".length) : "");
  const stateText = clip(fieldText(block, "**State:**").filter((t) => t).join(" "), 160);
  return {
    ok: true,
    slug,
    title: title || slug,
    status: m[1],
    updated: m[2],
    area: m[3],
    ball,
    ballLines: ballLines.length,
    state: stateText,
  };
}

export function fieldText(block, field) {
  const out = [];
  let grab = false;
  for (const ln of block) {
    if (ln.startsWith(field)) {
      grab = true;
      const rest = ln.slice(field.length).trim();
      if (rest) out.push(rest);
      continue;
    }
    if (grab) {
      if (/^\*\*[^*]+:\*\*/.test(ln)) break;
      out.push(ln.trim());
    }
  }
  return out;
}

export function firstBullet(block) {
  for (const ln of fieldText(block, "**Next:**")) {
    if (ln.startsWith("- ")) return ln.slice(2).trim();
  }
  return "";
}

export function clip(s, n) {
  s = s.replace(/\s+/gu, " ").trim();
  const cps = Array.from(s);
  return cps.length <= n ? s : cps.slice(0, n - 1).join("").trimEnd() + "…";
}

// Port of lint.py stream_rows + generate_index. `files` is a Map or object: path -> text.
export function generateIndex(files) {
  const entries = files instanceof Map ? [...files.entries()] : Object.entries(files);
  const names = entries
    .map(([p]) => p)
    .filter((p) => /^streams\/[^/]+\.md$/.test(p))
    .map((p) => p.slice("streams/".length))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)); // sorted(os.listdir()) sorts filenames with .md
  const get = (p) => (files instanceof Map ? files.get(p) : files[p]);
  const rows = [];
  for (const fn of names) {
    const text = get("streams/" + fn).replace(/\r\n/g, "\n");
    const lines = splitLines(text);
    const m = lines.length > 1 ? LINE2.exec(lines[1]) : null;
    if (!m) continue;
    const range = nowRange(lines);
    const block = range ? lines.slice(range[0], range[1]) : [];
    let state = fieldText(block, "**State:**").filter((t) => t).join(" ");
    let nxt = firstBullet(block);
    state = clip(state, 160) || "(no state)";
    nxt = clip(nxt, 100) || "(no next step)";
    const body = `${state} → ${nxt}`.replaceAll("|", "/");
    rows.push([fn.slice(0, -3), m[1], m[2], body]);
  }
  // Stable sort by updated, newest first; ties keep filename order.
  rows.sort((a, b) => (a[2] < b[2] ? 1 : a[2] > b[2] ? -1 : 0));
  const out = [...INDEX_HEADER];
  for (const [slug, status, upd, body] of rows) {
    out.push(`| [${slug}](streams/${slug}.md) | ${status} | ${upd} | ${body} |`);
  }
  return out.join("\n") + "\n";
}

// Edit only line 2 (status, updated) and the one Ball line. Everything else is preserved byte for byte.
export function editStream(rawText, { status, updated, ball }) {
  const lines = rawText.split("\n");
  if (lines.length < 2) throw new Error("stream is too short");
  const [l2, cr2] = stripCR(lines[1]);
  const m = LINE2.exec(l2);
  if (!m) throw new Error("line 2 is not 'status: … · updated: … · area: …'");
  const range = nowRange(lines);
  if (!range) throw new Error("no '## Now' section");
  const idx = [];
  for (let i = range[0]; i < range[1]; i++) if (lines[i].startsWith("**Ball:**")) idx.push(i);
  if (idx.length !== 1) throw new Error(`expected exactly one **Ball:** line, found ${idx.length}`);
  lines[1] = `status: ${status ?? m[1]} · updated: ${updated ?? m[2]} · area: ${m[3]}` + cr2;
  if (ball !== undefined) {
    const [, cr] = stripCR(lines[idx[0]]);
    lines[idx[0]] = `**Ball:** ${ball}` + cr;
  }
  return lines.join("\n");
}

// ---- board.json ----
export const BOARD_VERSION = 1;

export function validateBoard(obj) {
  const errs = [];
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return ["not an object"];
  if (obj.version !== BOARD_VERSION) errs.push(`version must be ${BOARD_VERSION}`);
  if (!Array.isArray(obj.todos)) return errs.concat("todos must be a list");
  const seen = new Set();
  obj.todos.forEach((t, i) => {
    const at = `todos[${i}]`;
    if (t === null || typeof t !== "object" || Array.isArray(t)) return errs.push(`${at} is not an object`);
    if (typeof t.id !== "string" || !t.id) errs.push(`${at}.id missing`);
    else if (seen.has(t.id)) errs.push(`${at}.id repeats`);
    else seen.add(t.id);
    if (typeof t.title !== "string" || !t.title.trim()) errs.push(`${at}.title missing`);
    if (!STAGES.includes(t.stage)) errs.push(`${at}.stage invalid`);
    if (typeof t.ball !== "string" || !validBallString(t.ball)) errs.push(`${at}.ball invalid`);
    if (typeof t.created !== "string" || !realDate(t.created)) errs.push(`${at}.created invalid`);
    if (typeof t.updated !== "string" || !realDate(t.updated)) errs.push(`${at}.updated invalid`);
  });
  return errs;
}

export function validBallString(s) {
  if (s === "me" || s === "none") return true;
  const m = BALL_WHO.exec(s);
  return !!m && realDate(m[2]) && !/[\r\n]/.test(m[1]);
}

// Returns {state: "ok", data} | {state: "missing"|"damaged", reason}
export function parseBoard(text) {
  if (text === undefined || text === null) return { state: "missing", reason: "board.json is not in the repo" };
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    return { state: "damaged", reason: "board.json is not valid JSON" };
  }
  const errs = validateBoard(obj);
  if (errs.length) return { state: "damaged", reason: "board.json: " + errs.slice(0, 3).join("; ") };
  return { state: "ok", data: obj };
}

export function serializeBoard(obj) {
  return JSON.stringify(obj, null, 2) + "\n";
}

// ---- cards ----
export function buildCards(files) {
  const cards = [];
  let skipped = 0;
  const get = (p) => (files instanceof Map ? files.get(p) : files[p]);
  const paths = (files instanceof Map ? [...files.keys()] : Object.keys(files)).filter((p) => /^streams\/[^/]+\.md$/.test(p)).sort();
  for (const p of paths) {
    const slug = p.slice("streams/".length, -3);
    const s = parseStream(slug, get(p));
    if (!s.ok || !STREAM_STATUS.includes(s.status) || s.ballLines !== 1) {
      skipped++;
      continue;
    }
    cards.push({
      id: "s:" + slug,
      kind: "stream",
      title: s.title,
      stage: s.status,
      ball: s.ball,
      updated: s.updated,
      area: s.area,
      detail: s.state,
      lane: laneFor(s.status, s.ball),
    });
  }
  const board = parseBoard(get("board.json"));
  if (board.state === "ok") {
    for (const t of board.data.todos) {
      const ball = parseBall(t.ball);
      cards.push({
        id: "t:" + t.id,
        kind: "todo",
        title: t.title,
        stage: t.stage,
        ball,
        updated: t.updated,
        area: null,
        detail: "",
        lane: laneFor(t.stage, ball),
      });
    }
  }
  cards.sort((a, b) => (a.updated < b.updated ? 1 : a.updated > b.updated ? -1 : a.title < b.title ? -1 : a.title > b.title ? 1 : 0));
  return { cards, skipped, board };
}

export function cleanWho(raw) {
  const w = (raw || "").replace(/\s+/gu, " ").trim();
  if (!w) return { error: "Enter a name." };
  if (w.length > 60) return { error: "Keep the name under 60 characters." };
  if (/^(me|none)$/i.test(w)) return { error: "Name someone other than you." };
  return { who: w };
}

export function cleanTitle(raw) {
  const t = (raw || "").replace(/\s+/gu, " ").trim();
  if (!t) return { error: "Type a to-do first." };
  if (t.length > 200) return { error: "Keep it under 200 characters." };
  return { title: t };
}

function newTodoId(now, rand) {
  return "t" + now.getTime().toString(36) + Math.floor(rand() * 36 ** 4).toString(36).padStart(4, "0");
}

// ---- planning ----
// A plan is { kind: "ok", changes: [{path, text}], message } | { kind: "refused"|"needs-who"|"noop"|"error", reason }
export function planAddTodo(files, rawTitle, { today, now = new Date(), rand = Math.random }) {
  const t = cleanTitle(rawTitle);
  if (t.error) return { kind: "error", reason: t.error };
  const board = parseBoard(files.get("board.json"));
  if (board.state !== "ok") return { kind: "error", reason: "The board is read-only: " + board.reason };
  const next = { ...board.data, todos: [...board.data.todos] };
  next.todos.push({ id: newTodoId(now, rand), title: t.title, stage: "backlog", ball: "none", created: today, updated: today });
  return { kind: "ok", message: "board: add to-do", changes: [{ path: "board.json", text: serializeBoard(next) }], texts: [t.title] };
}

export function planMove(files, cardId, to, { today, who } = {}) {
  const laneIds = LANES.map((l) => l.id);
  if (!laneIds.includes(to)) return { kind: "error", reason: "Unknown lane." };
  const { cards, board } = buildCards(files);
  const card = cards.find((c) => c.id === cardId);
  if (!card) return { kind: "error", reason: "That card is no longer there." };
  if (card.kind === "stream" && to === "backlog") return { kind: "refused", reason: BACKLOG_REFUSAL };
  if (card.lane === to) return { kind: "noop", reason: "Already there." };
  if (board.state !== "ok") return { kind: "error", reason: "The board is read-only: " + board.reason };

  let stage;
  let ballStr; // undefined = leave as is
  if (to === "backlog") {
    stage = "backlog";
    ballStr = "none";
  } else if (to === "progress") {
    stage = "active";
    ballStr = "me";
  } else if (to === "waiting") {
    stage = "active";
    if (card.ball.kind === "who") {
      ballStr = undefined; // already names someone (a parked or finished card): keep that line
    } else {
      const w = cleanWho(who);
      if (!who) return { kind: "needs-who", reason: "On whom?" };
      if (w.error) return { kind: "needs-who", reason: w.error };
      ballStr = `${w.who} since ${today}`;
    }
  } else if (to === "parked") {
    stage = "paused";
    ballStr = undefined;
  } else {
    stage = "done";
    ballStr = "none";
  }
  const changes = [];
  const texts = [];
  if (card.kind === "stream") {
    const path = `streams/${cardId.slice(2)}.md`;
    let text;
    try {
      text = editStream(files.get(path), { status: stage, updated: today, ball: ballStr });
    } catch (e) {
      return { kind: "error", reason: "Can't edit this stream: " + e.message };
    }
    changes.push({ path, text });
    if (ballStr) texts.push(ballStr);
    const next = new Map(files);
    next.set(path, text);
    const idx = generateIndex(next);
    if (idx !== files.get("INDEX.md")) changes.push({ path: "INDEX.md", text: idx });
  } else {
    const id = cardId.slice(2);
    const data = { ...board.data, todos: board.data.todos.map((t) => ({ ...t })) };
    const t = data.todos.find((x) => x.id === id);
    t.stage = stage;
    t.updated = today;
    if (ballStr !== undefined) t.ball = ballStr;
    changes.push({ path: "board.json", text: serializeBoard(data) });
    if (ballStr) texts.push(ballStr);
  }
  const lane = LANES.find((l) => l.id === to).label;
  return { kind: "ok", message: `board: ${cardId.slice(2)} → ${lane.toLowerCase()}`, changes, texts };
}
