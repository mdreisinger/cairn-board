// GitHubBackend against a local HTTP server that implements the Git Data endpoints. Never touches api.github.com.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";
import { GitHubBackend } from "../../js/backends/github.js";
import { Board } from "../../js/board.js";
import { BoardError, notSaved } from "../../js/errors.js";
import { planMove, planAddTodo } from "../../js/model.js";
import { fixtureFiles } from "../../sandbox/fixture.js";

const FAKE_TOKEN = ["gh", "p_", "Mock", "Token", "0123456789abcdefghijklmnopqrstuv"].join("");
const OWNER = "someone";
const REPO = "data-repo";
const sha = (kind, body) => createHash("sha1").update(kind + ":" + body).digest("hex");

function startServer(files) {
  const blobs = new Map();
  const trees = new Map();
  const commits = new Map();
  const mk = (map) => {
    const entries = new Map();
    for (const [p, t] of Object.entries(map)) {
      const s = sha("blob", t);
      blobs.set(s, t);
      entries.set(p, s);
    }
    return entries;
  };
  const putTree = (entries) => {
    const s = sha("tree", JSON.stringify([...entries]));
    trees.set(s, entries);
    return s;
  };
  const rootTree = putTree(mk(files));
  const c0 = sha("commit", "root");
  commits.set(c0, { tree: rootTree, parents: [] });
  const st = { head: c0, requests: [], rateLimit: false, auth401: false, refPatchStatus: null, headersSeen: [] };
  const ancestors = (s, target) => s === target || (commits.get(s)?.parents || []).some((p) => ancestors(p, target));

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const json = body ? JSON.parse(body) : undefined;
      st.requests.push({ method: req.method, url: req.url, body: json, headers: req.headers });
      const send = (code, obj, extra = {}) => {
        res.writeHead(code, { "content-type": "application/json", ...extra });
        res.end(obj === undefined ? "" : JSON.stringify(obj));
      };
      if (req.headers.authorization !== "Bearer " + FAKE_TOKEN) return send(401, { message: "Bad credentials" });
      if (st.auth401) return send(401, { message: "Bad credentials" });
      if (st.rateLimit) return send(403, { message: "API rate limit exceeded" }, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1893456000" });
      const base = `/repos/${OWNER}/${REPO}/git/`;
      if (!req.url.startsWith(base)) return send(404, { message: "Not Found" });
      const path = req.url.slice(base.length);
      let m;
      if (req.method === "GET" && path === "ref/heads/main") {
        const etag = `"${st.head}"`;
        if (req.headers["if-none-match"] === etag) return send(304, undefined, { etag });
        return send(200, { ref: "refs/heads/main", object: { sha: st.head, type: "commit" } }, { etag });
      }
      if (req.method === "GET" && (m = path.match(/^commits\/(\w+)$/))) {
        const c = commits.get(m[1]);
        return c ? send(200, { sha: m[1], tree: { sha: c.tree }, parents: c.parents.map((p) => ({ sha: p })) }) : send(404, { message: "Not Found" });
      }
      if (req.method === "GET" && (m = path.match(/^trees\/(\w+)\?recursive=1$/))) {
        const t = trees.get(m[1]);
        return t ? send(200, { sha: m[1], truncated: false, tree: [...t].map(([p, s]) => ({ path: p, mode: "100644", type: "blob", sha: s })) }) : send(404, { message: "Not Found" });
      }
      if (req.method === "GET" && (m = path.match(/^blobs\/(\w+)$/))) {
        const b = blobs.get(m[1]);
        return b === undefined ? send(404, { message: "Not Found" }) : send(200, { sha: m[1], encoding: "base64", content: Buffer.from(b).toString("base64").replace(/(.{60})/g, "$1\n") });
      }
      if (req.method === "POST" && path === "blobs") {
        if (json.encoding !== "utf-8") return send(422, { message: "bad encoding" });
        const s = sha("blob", json.content);
        blobs.set(s, json.content);
        return send(201, { sha: s });
      }
      if (req.method === "POST" && path === "trees") {
        const base = new Map(trees.get(json.base_tree));
        for (const e of json.tree) {
          if (e.mode !== "100644" || e.type !== "blob" || !blobs.has(e.sha)) return send(422, { message: "bad tree entry" });
          base.set(e.path, e.sha);
        }
        return send(201, { sha: putTree(base) });
      }
      if (req.method === "POST" && path === "commits") {
        const s = sha("commit", JSON.stringify(json) + commits.size);
        commits.set(s, { tree: json.tree, parents: json.parents, message: json.message });
        return send(201, { sha: s });
      }
      if (req.method === "PATCH" && path === "refs/heads/main") {
        if (st.refPatchStatus) return send(st.refPatchStatus, { message: "Update is not a fast forward" });
        if (json.force !== false) return send(422, { message: "force must be false" });
        if (!ancestors(json.sha, st.head)) return send(422, { message: "Update is not a fast forward" });
        st.head = json.sha;
        return send(200, { ref: "refs/heads/main", object: { sha: json.sha } });
      }
      send(404, { message: "Not Found" });
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        st, commits, blobs, trees,
        url: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((r) => server.close(r)),
        // a second writer: advance the branch directly
        externalCommit: () => {
          const c = commits.get(st.head);
          const tree = new Map(trees.get(c.tree));
          const b = "other\n";
          blobs.set(sha("blob", b), b);
          tree.set("other.txt", sha("blob", b));
          const t = putTree(tree);
          const s = sha("commit", "ext" + commits.size);
          commits.set(s, { tree: t, parents: [st.head] });
          st.head = s;
        },
      })
    )
  );
}

const backendFor = (srv, token = FAKE_TOKEN) => new GitHubBackend({ owner: OWNER, repo: REPO, branch: "main", token, apiBase: srv.url });

test("read path: ref, commit, recursive tree, blobs; every request authorised and to the mock only", async () => {
  const srv = await startServer(fixtureFiles());
  try {
    const board = new Board(backendFor(srv));
    const snap = await board.load();
    assert.equal(snap.head, srv.st.head);
    assert.ok(snap.files.has("board.json") && snap.files.has("streams/garden-shed.md") && snap.files.has("INDEX.md"));
    assert.equal(snap.files.get("streams/garden-shed.md"), fixtureFiles()["streams/garden-shed.md"]);
    for (const r of srv.st.requests) {
      assert.equal(r.headers.authorization, "Bearer " + FAKE_TOKEN);
      assert.equal(r.headers.accept, "application/vnd.github+json");
      assert.equal(r.headers["x-github-api-version"], "2022-11-28");
      assert.ok(r.url.startsWith(`/repos/${OWNER}/${REPO}/git/`));
    }
    assert.deepEqual(srv.st.requests.slice(0, 3).map((r) => r.url.replace(/[0-9a-f]{40}/, "SHA")), [
      `/repos/${OWNER}/${REPO}/git/ref/heads/main`,
      `/repos/${OWNER}/${REPO}/git/commits/SHA`,
      `/repos/${OWNER}/${REPO}/git/trees/SHA?recursive=1`,
    ]);
  } finally {
    await srv.close();
  }
});

test("write path: blobs, tree with base_tree, commit with parent, ref PATCH with force false, in that order", async () => {
  const srv = await startServer(fixtureFiles());
  try {
    const board = new Board(backendFor(srv));
    const snap = await board.load();
    const n0 = srv.st.requests.length;
    const plan = planMove(snap.files, "s:garden-shed", "waiting", { today: "2026-10-30", who: "Dana" });
    const next = await board.commit(plan, snap);
    const w = srv.st.requests.slice(n0).map((r) => `${r.method} ${r.url.replace(`/repos/${OWNER}/${REPO}/git/`, "").replace(/[0-9a-f]{40}/, "SHA")}`);
    assert.deepEqual(w, ["GET ref/heads/main", "GET commits/SHA", "POST blobs", "POST blobs", "POST trees", "POST commits", "PATCH refs/heads/main"]);
    const reqs = srv.st.requests.slice(n0);
    const tree = reqs.find((r) => r.url.endsWith("/trees"));
    assert.equal(tree.body.base_tree, snap.treeSha);
    assert.deepEqual(tree.body.tree.map((e) => [e.path, e.mode, e.type]).sort(), [["INDEX.md", "100644", "blob"], ["streams/garden-shed.md", "100644", "blob"]]);
    const commit = reqs.find((r) => r.url.endsWith("/commits"));
    assert.deepEqual(commit.body.parents, [snap.head]);
    assert.equal(commit.body.message, "board: garden-shed → waiting on others");
    const patch = reqs.find((r) => r.method === "PATCH");
    assert.deepEqual(patch.body, { sha: next.head, force: false });
    assert.equal(srv.st.head, next.head);
    assert.ok(reqs.filter((r) => r.method === "POST" && r.url.endsWith("/blobs")).every((r) => r.body.encoding === "utf-8"));
    // content really changed on the server
    const treeEntries = srv.trees.get(srv.commits.get(srv.st.head).tree);
    assert.ok(srv.blobs.get(treeEntries.get("streams/garden-shed.md")).includes("**Ball:** Dana since 2026-10-30"));
  } finally {
    await srv.close();
  }
});

test("422 on the ref update gives Not saved, and no commit becomes the branch head", async () => {
  const srv = await startServer(fixtureFiles());
  try {
    const board = new Board(backendFor(srv));
    const snap = await board.load();
    srv.st.refPatchStatus = 422;
    const before = srv.st.head;
    await assert.rejects(board.commit(planAddTodo(snap.files, "Water plants", { today: "2026-10-30" }), snap), (e) => {
      assert.equal(e.kind, "conflict");
      assert.match(notSaved(e), /^Not saved\. The repo changed/);
      return true;
    });
    assert.equal(srv.st.head, before);
    for (const r of srv.st.requests.filter((r) => r.method === "PATCH")) assert.equal(r.body.force, false);
    srv.st.refPatchStatus = 409;
    await assert.rejects(board.commit(planAddTodo(snap.files, "Water plants", { today: "2026-10-30" }), snap), (e) => e.kind === "conflict");
  } finally {
    await srv.close();
  }
});

test("branch moved since the board read it: refused before any object is created", async () => {
  const srv = await startServer(fixtureFiles());
  try {
    const board = new Board(backendFor(srv));
    const snap = await board.load();
    srv.externalCommit();
    const n0 = srv.st.requests.length;
    await assert.rejects(board.commit(planAddTodo(snap.files, "x", { today: "2026-10-30" }), snap), (e) => e.kind === "conflict");
    assert.ok(srv.st.requests.slice(n0).every((r) => r.method === "GET"));
  } finally {
    await srv.close();
  }
});

test("ETag: the second ref read sends If-None-Match and a 304 means unchanged; a fresh read skips it", async () => {
  const srv = await startServer(fixtureFiles());
  try {
    const b = backendFor(srv);
    const r1 = await b.getRef();
    assert.equal(r1.changed, true);
    const r2 = await b.getRef();
    assert.equal(r2.changed, false);
    assert.equal(r2.sha, r1.sha);
    const reqs = srv.st.requests.filter((r) => r.url.includes("/ref/heads/"));
    assert.equal(reqs[0].headers["if-none-match"], undefined);
    assert.equal(reqs[1].headers["if-none-match"], `"${r1.sha}"`);
    await b.getRef({ fresh: true });
    assert.equal(srv.st.requests.filter((r) => r.url.includes("/ref/heads/")).at(-1).headers["if-none-match"], undefined);
    srv.externalCommit();
    const r3 = await b.getRef();
    assert.equal(r3.changed, true);
    assert.equal(r3.sha, srv.st.head);
  } finally {
    await srv.close();
  }
});

test("401 and rate limit give clear messages that never include the token", async () => {
  const srv = await startServer(fixtureFiles());
  try {
    const bad = backendFor(srv, "wrong-token-value");
    await assert.rejects(bad.getRef(), (e) => {
      assert.equal(e.kind, "auth");
      assert.match(e.message, /rejected the token/);
      assert.ok(!e.message.includes("wrong-token-value"));
      return true;
    });
    const good = backendFor(srv);
    srv.st.rateLimit = true;
    await assert.rejects(good.getRef(), (e) => {
      assert.equal(e.kind, "ratelimit");
      assert.match(e.message, /rate limit/i);
      assert.ok(!e.message.includes(FAKE_TOKEN));
      return true;
    });
    srv.st.rateLimit = false;
    srv.st.auth401 = true;
    await assert.rejects(good.getRef(), (e) => e instanceof BoardError && e.kind === "auth");
  } finally {
    await srv.close();
  }
});

test("unknown repo is a 404 message; a dead server is a network message", async () => {
  const srv = await startServer(fixtureFiles());
  const b = new GitHubBackend({ owner: "nobody", repo: "nothing", token: FAKE_TOKEN, apiBase: srv.url });
  await assert.rejects(b.getRef(), (e) => e.kind === "notfound");
  await srv.close();
  await assert.rejects(backendFor(srv).getRef(), (e) => e.kind === "network");
});
