import { LANES, buildCards, planAddTodo, planMove, todayLocal, addDays } from "./model.js";
import { Board } from "./board.js";
import { BoardError, explain, notSaved } from "./errors.js";
import { GitHubBackend } from "./backends/github.js";
import { DryRunBackend } from "./backends/dryrun.js";
import { loadSettings, saveSettings, clearSettings, validSettings } from "./store.js";

const POLL_MS = 30000;
const root = document.getElementById("app");
const params = new URLSearchParams(location.search);
const sandbox = params.get("sandbox") === "1";

const state = {
  screen: "boot", // boot | setup | settings | board
  settings: null,
  board: null,
  backend: null,
  snapshot: null,
  view: null, // buildCards result
  loadError: null,
  status: null, // {kind: saving|saved|error|refused|info, text, retry}
  pendingWho: null,
  whoError: "",
  showOlder: false,
  busy: false,
  setupNote: "",
  addDraft: "",
};

// ---- tiny DOM helper: text only, never HTML ----
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat()) {
    if (kid === null || kid === undefined || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

function setStatus(s) {
  state.status = s;
  renderStatus();
}

// ---- boot ----
function start() {
  if (sandbox) {
    // Dynamic import keeps the fixture out of the normal path.
    import("../sandbox/fixture.js").then(({ fixtureFiles }) => {
      state.backend = new DryRunBackend(fixtureFiles());
      window.__cairnSandbox = state.backend;
      state.board = new Board(state.backend);
      state.screen = "board";
      refresh();
    });
    return;
  }
  const s = loadSettings();
  if (!s) {
    state.screen = "setup";
    render();
    return;
  }
  connect(s);
}

function connect(s) {
  state.settings = s;
  state.backend = new GitHubBackend(s);
  state.board = new Board(state.backend);
  state.screen = "board";
  refresh();
}

async function refresh() {
  state.loadError = null;
  render();
  try {
    state.snapshot = await state.board.load();
    state.view = buildCards(state.snapshot.files);
  } catch (e) {
    state.loadError = explain(e);
  }
  render();
}

// ---- polling ----
async function poll() {
  if (state.screen !== "board" || state.busy || !state.snapshot || document.visibilityState !== "visible") return;
  try {
    if (await state.board.headChanged(state.snapshot)) await refresh();
  } catch (e) {
    if (e instanceof BoardError && ["auth", "ratelimit", "forbidden"].includes(e.kind)) setStatus({ kind: "info", text: explain(e) });
  }
}
setInterval(poll, POLL_MS);
document.addEventListener("visibilitychange", poll);

// ---- actions ----
function makePlan(intent) {
  const files = state.snapshot.files;
  const today = todayLocal();
  if (intent.type === "add") return planAddTodo(files, intent.title, { today });
  return planMove(files, intent.cardId, intent.to, { today, who: intent.who });
}

async function run(intent) {
  if (state.busy) return;
  if (!state.snapshot) return;
  if (state.view.board.state !== "ok") {
    setStatus({ kind: "error", text: "Read-only: " + state.view.board.reason });
    return;
  }
  const plan = makePlan(intent);
  if (plan.kind === "refused") return setStatus({ kind: "refused", text: "Not moved. " + plan.reason });
  if (plan.kind === "error") return setStatus({ kind: "refused", text: plan.reason });
  if (plan.kind === "noop") return setStatus(null);
  if (plan.kind === "needs-who") {
    state.pendingWho = { cardId: intent.cardId, to: intent.to };
    state.whoError = intent.who ? plan.reason : "";
    setStatus(null);
    return render();
  }
  state.busy = true;
  setStatus({ kind: "saving", text: "Saving…" });
  try {
    state.snapshot = await state.board.commit(plan, state.snapshot);
    state.view = buildCards(state.snapshot.files);
    state.pendingWho = null;
    if (intent.type === "add") state.addDraft = "";
    state.busy = false;
    setStatus({ kind: "saved", text: "Saved" });
    render();
  } catch (e) {
    state.busy = false;
    if (e instanceof BoardError && e.kind === "conflict") {
      setStatus({ kind: "error", text: notSaved(e), retry: () => retry(intent) });
    } else {
      const retryable = e instanceof BoardError && ["network", "api"].includes(e.kind);
      setStatus({ kind: "error", text: notSaved(e), retry: retryable ? () => retry(intent) : null });
    }
    render();
  }
}

// Retry re-reads the repo, then re-applies the action only if the card is still where the user saw it.
async function retry(intent) {
  setStatus({ kind: "saving", text: "Reloading…" });
  try {
    const before = intent.type === "move" ? state.view.cards.find((c) => c.id === intent.cardId) : null;
    state.snapshot = await state.board.load();
    state.view = buildCards(state.snapshot.files);
    if (before) {
      const now = state.view.cards.find((c) => c.id === intent.cardId);
      if (!now || now.lane !== before.lane) {
        setStatus({ kind: "error", text: "Not saved. That card changed in the repo meanwhile, so the move was dropped. Check it and try again.", retry: null });
        return render();
      }
    }
  } catch (e) {
    setStatus({ kind: "error", text: notSaved(e), retry: () => retry(intent) });
    return render();
  }
  render();
  await run(intent);
}

// ---- render ----
function render() {
  root.replaceChildren();
  if (state.screen === "setup") return root.append(setupScreen());
  if (state.screen === "settings") return root.append(settingsScreen());
  if (state.screen === "boot") return root.append(h("p", { class: "boot" }, "Loading"));
  root.append(boardScreen());
  renderStatus();
}

function renderStatus() {
  let el = document.getElementById("status");
  if (!el) {
    el = h("div", { id: "status", class: "status", hidden: true });
    document.body.append(el);
  }
  const s = state.status;
  el.replaceChildren();
  el.hidden = !s || state.screen !== "board";
  if (!s) return;
  el.className = "status " + s.kind;
  el.setAttribute("role", s.kind === "error" || s.kind === "refused" ? "alert" : "status");
  el.append(h("span", { class: "msg" }, s.text));
  if (s.retry) el.append(h("button", { type: "button", class: "btn", id: "retry", onclick: s.retry }, "Retry"));
  if (s.kind === "error" || s.kind === "refused" || s.kind === "info") {
    el.append(h("button", { type: "button", class: "btn quiet", id: "dismiss", onclick: () => setStatus(null) }, "Dismiss"));
  }
  if (s.kind === "saved") setTimeout(() => state.status === s && setStatus(null), 2500);
}

function header() {
  const bar = h("header", { class: "bar" }, h("h1", null, "Cairn board"));
  const tools = h("div", { class: "tools" });
  tools.append(h("button", { type: "button", class: "btn", id: "refresh", onclick: () => refresh() }, "Refresh"));
  if (!sandbox) tools.append(h("button", { type: "button", class: "btn", id: "open-settings", onclick: () => { state.screen = "settings"; render(); } }, "Settings"));
  bar.append(tools);
  return bar;
}

function sandboxBanner() {
  const b = state.backend;
  const box = h("div", { class: "banner sandbox", id: "sandbox-banner", role: "note" });
  box.append(
    h("strong", null, "SANDBOX"),
    " Invented data, in memory. Nothing is sent anywhere; commits are only recorded. ",
    h("button", { type: "button", class: "btn", id: "sim-other", onclick: async () => { await b.externalCommit(); setStatus({ kind: "info", text: "Another writer committed. The board hasn't refreshed yet." }); } }, "Simulate another writer")
  );
  const log = h("details", { class: "dry-log", id: "dry-log" }, h("summary", null, `Recorded commits (${b.recorded.length})`));
  const ul = h("ul");
  for (const c of b.recorded) ul.append(h("li", null, `${c.external ? "[other writer] " : ""}${c.message} — ${c.files.map((f) => f.path).join(", ")}`));
  log.append(ul);
  box.append(log);
  return box;
}

function boardScreen() {
  const wrap = h("main", { class: "page" });
  wrap.append(header());
  if (sandbox) wrap.append(sandboxBanner());
  if (state.loadError) {
    wrap.append(h("div", { class: "banner error", role: "alert", id: "load-error" }, state.loadError, " ", h("button", { type: "button", class: "btn", onclick: () => refresh() }, "Try again")));
    return wrap;
  }
  if (!state.view) {
    wrap.append(h("p", { class: "boot" }, "Loading"));
    return wrap;
  }
  const { board, skipped } = state.view;
  const readOnly = board.state !== "ok";
  if (readOnly) {
    wrap.append(h("div", { class: "banner readonly", role: "alert", id: "readonly-banner" }, `Read-only. ${board.reason}. The board won't create or overwrite it; fix it in the repo and refresh.`));
  }
  if (skipped) wrap.append(h("p", { class: "note" }, `${skipped} stream${skipped === 1 ? "" : "s"} skipped: line 2 or the Ball line isn't readable.`));
  wrap.append(addForm(readOnly));
  const lanes = h("div", { class: "lanes" });
  for (const lane of LANES) lanes.append(laneSection(lane, readOnly));
  wrap.append(lanes);
  return wrap;
}

function addForm(readOnly) {
  const input = h("input", { type: "text", id: "todo-title", name: "todo", placeholder: "Add a to-do", maxlength: "200", autocomplete: "off", enterkeyhint: "done", "aria-label": "New to-do", disabled: readOnly });
  input.value = state.addDraft;
  input.addEventListener("input", () => (state.addDraft = input.value));
  const form = h("form", { class: "add", id: "add-form", onsubmit: (e) => { e.preventDefault(); run({ type: "add", title: input.value }); } },
    input,
    h("button", { type: "submit", class: "btn primary", id: "add-btn", disabled: readOnly }, "Add")
  );
  return form;
}

function laneSection(lane, readOnly) {
  let cards = state.view.cards.filter((c) => c.lane === lane.id);
  let older = 0;
  if (lane.id === "done") {
    const cutoff = addDays(todayLocal(), -30);
    if (!state.showOlder) {
      const recent = cards.filter((c) => c.updated >= cutoff);
      older = cards.length - recent.length;
      cards = recent;
    }
  }
  const total = state.view.cards.filter((c) => c.lane === lane.id).length;
  const sec = h("section", { class: "lane", id: "lane-" + lane.id, "aria-labelledby": "h-" + lane.id });
  sec.append(h("h2", { id: "h-" + lane.id }, lane.label, h("span", { class: "count" }, String(total))));
  if (lane.id === "waiting") {
    const groups = new Map();
    for (const c of cards) {
      const k = c.ball.who || "Unnamed";
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }
    for (const who of [...groups.keys()].sort((a, b) => a.localeCompare(b))) {
      sec.append(h("h3", { class: "group" }, who), ...groups.get(who).map((c) => cardEl(c, readOnly)));
    }
  } else {
    sec.append(...cards.map((c) => cardEl(c, readOnly)));
  }
  if (!cards.length && !older) sec.append(h("p", { class: "empty" }, "Nothing here"));
  if (lane.id === "done" && (older || state.showOlder)) {
    sec.append(h("button", { type: "button", class: "btn quiet", id: "older", onclick: () => { state.showOlder = !state.showOlder; render(); } }, state.showOlder ? "Hide older" : `Older: ${older}`));
  }
  return sec;
}

function cardEl(c, readOnly) {
  const el = h("article", { class: "card", "data-id": c.id, "data-kind": c.kind });
  el.append(h("p", { class: "title" }, c.title));
  const chips = h("p", { class: "chips" }, h("span", { class: "chip" }, c.kind === "stream" ? "stream" : "to-do"));
  if (c.area) chips.append(h("span", { class: "chip" }, c.area));
  if (c.ball.kind === "who") chips.append(h("span", { class: "chip ball" }, `${c.ball.who}${c.ball.since ? " since " + c.ball.since : ""}`));
  chips.append(h("span", { class: "chip dim" }, "updated " + c.updated));
  el.append(chips);
  if (c.detail) el.append(h("p", { class: "detail" }, c.detail));
  const sel = h("select", { class: "move", "aria-label": `Move “${c.title}” to`, disabled: readOnly || state.busy },
    h("option", { value: "" }, "Move to…"),
    ...LANES.map((l) => h("option", { value: l.id, disabled: l.id === c.lane }, l.label))
  );
  sel.addEventListener("change", () => {
    const to = sel.value;
    sel.value = "";
    if (to) run({ type: "move", cardId: c.id, to, who: null });
  });
  el.append(sel);
  if (state.pendingWho && state.pendingWho.cardId === c.id) el.append(whoForm(c));
  return el;
}

function whoForm(c) {
  const input = h("input", { type: "text", class: "who", name: "who", maxlength: "60", autocomplete: "off", "aria-label": "On whom?", placeholder: "Name" });
  const form = h("form", { class: "who-form", onsubmit: (e) => { e.preventDefault(); run({ type: "move", cardId: c.id, to: state.pendingWho.to, who: input.value || " " }); } },
    h("label", null, "On whom?"),
    input,
    state.whoError ? h("p", { class: "field-error", role: "alert" }, state.whoError) : null,
    h("div", { class: "row" },
      h("button", { type: "submit", class: "btn primary" }, "Move"),
      h("button", { type: "button", class: "btn", onclick: () => { state.pendingWho = null; state.whoError = ""; render(); } }, "Cancel")
    )
  );
  setTimeout(() => input.focus(), 0);
  return form;
}

// ---- setup and settings ----
function stored(s) {
  return `${s.owner}/${s.repo} on branch ${s.branch}, and a token of ${s.token.length} characters`;
}

function setupScreen() {
  const f = {};
  const field = (label, name, attrs) => {
    f[name] = h("input", { name, id: "f-" + name, required: attrs.required, ...attrs });
    return h("label", { class: "fld", for: "f-" + name }, label, f[name]);
  };
  const err = h("p", { class: "field-error", role: "alert", id: "setup-error" });
  const form = h("form", { class: "setup", id: "setup-form", onsubmit: (e) => {
    e.preventDefault();
    const v = validSettings(Object.fromEntries(Object.entries(f).map(([k, el]) => [k, el.value])));
    if (v.error) { err.textContent = v.error; return; }
    const r = saveSettings(v.settings);
    state.setupNote = r.persisted
      ? `Saved on this device: ${stored(v.settings)}.`
      : `Browser storage is unavailable here, so ${stored(v.settings)} are kept in memory until you close this page.`;
    connect(v.settings);
    setStatus({ kind: "info", text: state.setupNote });
  } },
    field("Owner (GitHub login)", "owner", { type: "text", autocomplete: "off", autocapitalize: "none", spellcheck: "false", required: true, placeholder: "your-login" }),
    field("Repo", "repo", { type: "text", autocomplete: "off", autocapitalize: "none", spellcheck: "false", required: true, placeholder: "your-private-repo" }),
    field("Branch", "branch", { type: "text", autocomplete: "off", autocapitalize: "none", spellcheck: "false", value: "main" }),
    field("Fine-grained token", "token", { type: "password", autocomplete: "off", autocapitalize: "none", spellcheck: "false", required: true }),
    err,
    h("button", { type: "submit", class: "btn primary", id: "setup-save" }, "Save and open the board")
  );
  return h("main", { class: "page" },
    h("header", { class: "bar" }, h("h1", null, "Cairn board setup")),
    h("p", null, "This page holds no data of its own. Point it at your private repo and give it a fine-grained token limited to that one repo with Contents: read and write."),
    h("div", { class: "banner", id: "storage-note" },
      h("strong", null, "What is stored. "),
      "Owner, repo, branch and the token are saved in this browser's localStorage on this device, as plain text. Nothing else is stored. They are sent only to api.github.com, the token only in the Authorization header. Sign out in Settings clears all of it."),
    form
  );
}

function settingsScreen() {
  const s = state.settings;
  return h("main", { class: "page" },
    h("header", { class: "bar" }, h("h1", null, "Settings")),
    h("div", { class: "banner", id: "stored-summary" }, h("strong", null, "Stored on this device. "), s ? stored(s) + "." : "Nothing."),
    h("p", null, "The token is never shown again. Sign out clears the owner, repo, branch and token from this browser."),
    h("div", { class: "row" },
      h("button", { type: "button", class: "btn", id: "back", onclick: () => { state.screen = "board"; render(); } }, "Back"),
      h("button", { type: "button", class: "btn danger", id: "sign-out", onclick: () => {
        clearSettings();
        Object.assign(state, { settings: null, snapshot: null, view: null, board: null, backend: null, status: null, screen: "setup" });
        render();
      } }, "Sign out and clear")
    )
  );
}

start();
