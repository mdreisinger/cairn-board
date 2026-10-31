// Real-browser test of the sandbox (?sandbox=1) at iPhone size, headless, throwaway profile, against a local static server.
// Env: PLAYWRIGHT_DIR (folder with node_modules/playwright), PLAYWRIGHT_BROWSERS_PATH, OUT_DIR (screenshots and profile).
import http from "node:http";
import { readFile, mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "../..");
const OUT = process.env.OUT_DIR || join(process.env.TMPDIR || "/tmp", "board-browser");
const require = createRequire(join(process.env.PLAYWRIGHT_DIR, "x.js"));
const { chromium } = require("playwright");

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".webmanifest": "application/manifest+json", ".png": "image/png", ".json": "application/json" };
const served = [];
const server = http.createServer(async (req, res) => {
  const path = new URL(req.url, "http://x").pathname;
  served.push(path);
  const file = join(ROOT, path === "/" ? "index.html" : path);
  if (!file.startsWith(ROOT) || file.includes("/.git/") || file.includes("/tests/")) { res.writeHead(404); return res.end(); }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch (e) {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
async function step(name, fn) {
  try {
    await fn();
    console.log("PASS " + name);
  } catch (e) {
    failures++;
    console.log("FAIL " + name + "\n     " + String(e.message).split("\n").slice(0, 6).join("\n     "));
  }
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const IPHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" };

async function newContext(name, extra = {}) {
  const ctx = await chromium.launchPersistentContext(join(OUT, "profile-" + name), { headless: true, ...IPHONE, ...extra });
  const seen = [];
  await ctx.route("**/*", (route) => {
    const u = new URL(route.request().url());
    seen.push(u.host);
    if (u.hostname === "127.0.0.1") return route.continue();
    return route.abort("blockedbyclient");
  });
  await ctx.addInitScript(() => {
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(e.violatedDirective + " " + e.blockedURI));
  });
  return { ctx, seen };
}

const lanesText = (page) => page.$$eval(".lane > h2", (hs) => hs.map((h) => h.firstChild.textContent));
const cardTitles = (page, lane) => page.$$eval(`#lane-${lane} .card .title`, (ts) => ts.map((t) => t.textContent));
const recorded = (page) => page.evaluate(() => window.__cairnSandbox.recorded.filter((r) => !r.external).map((r) => ({ message: r.message, files: r.files.map((f) => f.path) })));
const statusText = (page) => page.locator("#status").innerText();

// ---------- main sandbox run ----------
const { ctx, seen } = await newContext("main");
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push("pageerror " + e.message));
await page.goto(BASE + "/index.html?sandbox=1");
await page.waitForSelector("#lane-backlog");

await step("sandbox banner is visible, no token asked for", async () => {
  assert.ok(await page.locator("#sandbox-banner").isVisible());
  assert.match(await page.locator("#sandbox-banner").innerText(), /SANDBOX/);
  assert.equal(await page.locator('input[type="password"]').count(), 0);
});

await step("lanes in order and fixture cards in the right lanes", async () => {
  assert.deepEqual(await lanesText(page), ["Backlog", "In progress", "Waiting on others", "Parked", "Done"]);
  assert.deepEqual(await cardTitles(page, "backlog"), ["Buy shingles"]);
  assert.ok((await cardTitles(page, "progress")).includes("Garden shed"));
  assert.ok((await cardTitles(page, "waiting")).includes("Kitchen quote"));
  assert.ok((await cardTitles(page, "parked")).includes("Weekend trip"));
  const groups = await page.$$eval("#lane-waiting h3.group", (hs) => hs.map((h) => h.textContent));
  assert.deepEqual(groups, ["Lee", "Pat", "Robin"]);
});

await step("add a to-do: card in Backlog, one commit touching only board.json", async () => {
  await page.fill("#todo-title", "Paint the fence");
  await page.click("#add-btn");
  await page.waitForSelector('#lane-backlog .card:has-text("Paint the fence")');
  assert.match(await statusText(page), /Saved/);
  const rec = await recorded(page);
  assert.equal(rec.length, 1);
  assert.deepEqual(rec[0], { message: "board: add to-do", files: ["board.json"] });
  assert.equal(await page.inputValue("#todo-title"), "");
});

await step("move a stream to Waiting: asks On whom?, writes Ball and updated, stream+INDEX in one commit", async () => {
  await page.selectOption('[data-id="s:garden-shed"] select.move', "waiting");
  await page.waitForSelector('[data-id="s:garden-shed"] .who-form');
  assert.match(await page.locator('[data-id="s:garden-shed"] .who-form').innerText(), /On whom\?/);
  await page.fill('[data-id="s:garden-shed"] input.who', "Dana");
  await page.click('[data-id="s:garden-shed"] .who-form button[type=submit]');
  await page.waitForSelector('#lane-waiting .card[data-id="s:garden-shed"]');
  assert.ok((await page.$$eval("#lane-waiting h3.group", (h) => h.map((x) => x.textContent))).includes("Dana"));
  const rec = await recorded(page);
  assert.equal(rec.length, 2);
  assert.deepEqual(rec[1].files.sort(), ["INDEX.md", "streams/garden-shed.md"]);
  const text = await page.evaluate(() => window.__cairnSandbox.snapshotFiles()["streams/garden-shed.md"]);
  assert.match(text, /\*\*Ball:\*\* Dana since \d{4}-\d{2}-\d{2}\n/);
  assert.match(text, /status: active · updated: \d{4}-\d{2}-\d{2} · area: home/);
});

await step("move back to In progress sets Ball to me", async () => {
  await page.selectOption('[data-id="s:garden-shed"] select.move', "progress");
  await page.waitForSelector('#lane-progress .card[data-id="s:garden-shed"]');
  const text = await page.evaluate(() => window.__cairnSandbox.snapshotFiles()["streams/garden-shed.md"]);
  assert.match(text, /\*\*Ball:\*\* me\n/);
  assert.equal((await recorded(page)).length, 3);
});

await step("a stream to Backlog is refused, nothing written", async () => {
  await page.selectOption('[data-id="s:garden-shed"] select.move', "backlog");
  await page.waitForSelector("#status.refused");
  assert.match(await statusText(page), /It has already started; park it instead\./);
  assert.equal((await recorded(page)).length, 3);
  assert.ok((await cardTitles(page, "progress")).includes("Garden shed"));
  await page.click("#dismiss");
});

await step("a to-do can go to Waiting with a name", async () => {
  await page.selectOption('[data-id="t:t-demo-1"] select.move', "waiting");
  await page.fill('[data-id="t:t-demo-1"] input.who', "Kim");
  await page.click('[data-id="t:t-demo-1"] .who-form button[type=submit]');
  await page.waitForSelector('#lane-waiting .card[data-id="t:t-demo-1"]');
  const board = JSON.parse(await page.evaluate(() => window.__cairnSandbox.snapshotFiles()["board.json"]));
  assert.match(board.todos.find((t) => t.id === "t-demo-1").ball, /^Kim since \d{4}-\d{2}-\d{2}$/);
});

await step("stale write: Not saved with Retry, nothing written, Retry then saves", async () => {
  const before = (await recorded(page)).length;
  await page.click("#sim-other");
  await page.selectOption('[data-id="s:book-club"] select.move', "parked");
  await page.waitForSelector("#status.error");
  const msg = await statusText(page);
  assert.match(msg, /Not saved/);
  assert.ok(await page.locator("#retry").isVisible());
  assert.equal((await recorded(page)).length, before);
  assert.ok((await cardTitles(page, "progress")).includes("Book club"));
  await page.click("#retry");
  await page.waitForSelector('#lane-parked .card[data-id="s:book-club"]');
  assert.equal((await recorded(page)).length, before + 1);
});

await step("recorded commits list is visible in the banner", async () => {
  await page.click("#dry-log summary");
  const t = await page.locator("#dry-log").innerText();
  assert.match(t, /board: add to-do — board\.json/);
});

await step("no horizontal scroll at 390px (light), screenshot", async () => {
  const w = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, bw: document.body.scrollWidth }));
  assert.ok(w.sw <= w.iw && w.bw <= w.iw, JSON.stringify(w));
  await page.screenshot({ path: join(OUT, "iphone-light.png"), fullPage: true });
});

await step("dark mode, 320px and 1280px: no horizontal scroll, screenshots", async () => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: join(OUT, "iphone-dark.png"), fullPage: true });
  for (const [w, h] of [[320, 640], [1280, 900]]) {
    await page.setViewportSize({ width: w, height: h });
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    assert.ok(m.sw <= m.iw, `${w}px: ` + JSON.stringify(m));
    await page.screenshot({ path: join(OUT, `width-${w}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: "light" });
});

await step("page has no inline script, strict CSP meta, no CSP violations", async () => {
  const csp = await page.getAttribute('meta[http-equiv="Content-Security-Policy"]', "content");
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src https:\/\/api\.github\.com(;|$)/);
  assert.ok(!/unsafe-inline|unsafe-eval/.test(csp));
  assert.deepEqual(await page.$$eval("script", (s) => s.filter((x) => !x.src).map((x) => x.outerHTML.slice(0, 120))), []);
  assert.deepEqual(await page.$$eval("[onclick],[onload],[style]", (e) => e.filter((x) => x.getAttribute("style") !== "").map((x) => x.outerHTML.slice(0, 400))), []);
  assert.deepEqual(await page.evaluate(() => window.__csp), []);
  assert.deepEqual(consoleErrors, []);
});

await step("sandbox made no request to any host but 127.0.0.1", async () => {
  const hosts = [...new Set(seen)];
  assert.ok(hosts.length > 0);
  assert.deepEqual(hosts.filter((h) => !h.startsWith("127.0.0.1")), []);
});

await step("manifest, icons and module files are served", async () => {
  for (const p of ["/manifest.webmanifest", "/icons/icon-192.png", "/icons/icon-512.png", "/icons/apple-touch-icon.png", "/js/app.js", "/css/style.css"]) {
    const r = await ctx.request.get(BASE + p);
    assert.equal(r.status(), 200, p);
  }
  const m = await (await ctx.request.get(BASE + "/manifest.webmanifest")).json();
  assert.equal(m.display, "standalone");
});
await ctx.close();

// ---------- read-only banner for damaged board.json (sandbox + test hook via query) ----------
// The sandbox cannot be damaged from the URL; this is covered by unit tests and here by a route-level edit of the fixture module.
{
  const { ctx: c2 } = await newContext("damaged");
  await c2.route("**/sandbox/fixture.js", async (route) => {
    const src = await (await route.fetch()).text();
    route.fulfill({ contentType: "text/javascript", body: src.replace('"board.json": JSON.stringify(board, null, 2) + "\\n"', '"board.json": "{ broken"') });
  });
  const p2 = await c2.newPage();
  await p2.goto(BASE + "/index.html?sandbox=1");
  await step("damaged board.json: read-only banner, add and move disabled, nothing written", async () => {
    await p2.waitForSelector("#readonly-banner");
    assert.match(await p2.locator("#readonly-banner").innerText(), /Read-only/);
    assert.ok(await p2.locator("#add-btn").isDisabled());
    assert.ok(await p2.locator('[data-id="s:garden-shed"] select.move').isDisabled());
    assert.equal(await p2.evaluate(() => window.__cairnSandbox.recorded.length), 0);
    await p2.screenshot({ path: join(OUT, "readonly.png"), fullPage: true });
  });
  await c2.close();
}

// ---------- setup, sign out and CSP, with api.github.com answered locally by the test (no real call) ----------
{
  const { ctx: c3 } = await newContext("setup");
  const apiHits = [];
  await c3.route("https://api.github.com/**", (route) => {
    apiHits.push(route.request().url());
    route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "Bad credentials" }) });
  });
  const p3 = await c3.newPage();
  await p3.goto(BASE + "/index.html");
  await step("first run shows setup with a password field and says what is stored", async () => {
    await p3.waitForSelector("#setup-form");
    assert.equal(await p3.getAttribute("#f-token", "type"), "password");
    assert.match(await p3.locator("#storage-note").innerText(), /localStorage/);
    await p3.fill("#f-owner", "bad owner!");
    await p3.fill("#f-repo", "r");
    await p3.fill("#f-token", "x");
    await p3.click("#setup-save");
    assert.match(await p3.locator("#setup-error").innerText(), /Owner looks wrong/);
    assert.equal(apiHits.length, 0);
  });
  await step("save: 401 from the (locally faked) API shows a clear message; Settings shows what is stored, never the token; sign out clears", async () => {
    const fake = ["fake", "-token-", "123456"].join("");
    await p3.fill("#f-owner", "some-owner");
    await p3.fill("#f-repo", "some-repo");
    await p3.fill("#f-token", fake);
    await p3.click("#setup-save");
    await p3.waitForSelector("#load-error");
    assert.match(await p3.locator("#load-error").innerText(), /rejected the token/);
    assert.ok(apiHits.every((u) => u.startsWith("https://api.github.com/repos/some-owner/some-repo/git/ref/heads/main")));
    const stored = await p3.evaluate(() => Object.keys(localStorage).map((k) => localStorage.getItem(k)).join("|"));
    assert.ok(stored.includes("some-owner") && stored.includes(fake));
    await p3.click("#open-settings");
    const t = await p3.locator("#stored-summary").innerText();
    assert.match(t, /some-owner\/some-repo/);
    assert.ok(!t.includes(fake));
    await p3.click("#sign-out");
    await p3.waitForSelector("#setup-form");
    assert.equal(await p3.evaluate(() => localStorage.length), 0);
  });
  await step("CSP blocks a request to any other host", async () => {
    const r = await p3.evaluate(() => fetch("https://example.com/").then(() => "sent", () => "blocked"));
    assert.equal(r, "blocked");
    await p3.waitForTimeout(100);
    const v = await p3.evaluate(() => window.__csp);
    assert.ok(v.some((x) => x.startsWith("connect-src")), JSON.stringify(v));
  });
  await c3.close();
}

server.close();
console.log(failures ? `\n${failures} browser check(s) FAILED` : "\nall browser checks passed");
console.log("screenshots in " + OUT);
process.exit(failures ? 1 : 0);
