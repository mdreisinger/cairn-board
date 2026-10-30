// DryRunBackend: in-memory Git Data API semantics over a fixture repo. Nothing leaves the page.
// Records every commit it would have made in `recorded`.
import { BoardError } from "../errors.js";

function hex40(str) {
  // Not cryptographic. Deterministic, 40 hex chars, enough to tell objects apart in a sandbox.
  let out = "";
  for (let seed = 0; seed < 5; seed++) {
    let h = (0x811c9dc5 ^ (seed * 0x9e3779b1)) >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    out += h.toString(16).padStart(8, "0");
  }
  return out;
}

export class DryRunBackend {
  constructor(files, { branch = "main" } = {}) {
    this.isDryRun = true;
    this.branch = branch;
    this.blobs = new Map(); // sha -> text
    this.trees = new Map(); // sha -> Map(path -> blob sha)
    this.commits = new Map(); // sha -> {tree, parents, message}
    this.recorded = [];
    this._n = 0;
    const entries = new Map();
    for (const [path, text] of Object.entries(files)) entries.set(path, this._putBlob(text));
    const tree = this._putTree(entries);
    const root = this._putCommit("sandbox: initial fixture", tree, []);
    this.head = root;
  }

  _id(kind, body) {
    return hex40(`${kind}:${this._n++}:${body}`);
  }
  _putBlob(text) {
    const sha = this._id("blob", text);
    this.blobs.set(sha, text);
    return sha;
  }
  _putTree(map) {
    const sha = this._id("tree", [...map].join("|"));
    this.trees.set(sha, map);
    return sha;
  }
  _putCommit(message, tree, parents) {
    const sha = this._id("commit", message + tree + parents.join(","));
    this.commits.set(sha, { tree, parents, message });
    return sha;
  }

  async getRef() {
    return { sha: this.head, changed: true };
  }
  async getCommit(sha) {
    const c = this.commits.get(sha);
    if (!c) throw new BoardError("notfound", "No such commit (sandbox).");
    return { sha, tree: c.tree, parents: c.parents };
  }
  async getTree(sha) {
    const t = this.trees.get(sha);
    if (!t) throw new BoardError("notfound", "No such tree (sandbox).");
    return [...t].map(([path, s]) => ({ path, mode: "100644", sha: s }));
  }
  async getBlob(sha) {
    if (!this.blobs.has(sha)) throw new BoardError("notfound", "No such blob (sandbox).");
    return this.blobs.get(sha);
  }
  async createBlob(text) {
    return this._putBlob(text);
  }
  async createTree(baseTree, entries) {
    const base = this.trees.get(baseTree);
    if (!base) throw new BoardError("api", "Bad base_tree (sandbox).");
    const next = new Map(base);
    for (const e of entries) {
      if (!this.blobs.has(e.sha)) throw new BoardError("api", "Bad blob sha (sandbox).");
      next.set(e.path, e.sha);
    }
    return this._putTree(next);
  }
  async createCommit(message, tree, parents) {
    if (!this.trees.has(tree)) throw new BoardError("api", "Bad tree (sandbox).");
    return this._putCommit(message, tree, parents);
  }
  _descends(sha, ancestor) {
    const seen = new Set();
    const stack = [sha];
    while (stack.length) {
      const s = stack.pop();
      if (s === ancestor) return true;
      if (seen.has(s)) continue;
      seen.add(s);
      const c = this.commits.get(s);
      if (c) stack.push(...c.parents);
    }
    return false;
  }
  // force is always false in the board; a stale update is refused exactly like GitHub's 422.
  async updateRef(sha) {
    if (!this.commits.has(sha)) throw new BoardError("api", "Bad commit (sandbox).");
    if (!this._descends(sha, this.head)) {
      throw new BoardError("conflict", "The repo changed since the board last read it.", { status: 422 });
    }
    this._record(sha, false);
    this.head = sha;
  }

  _record(sha, external) {
    const c = this.commits.get(sha);
    const parentTree = c.parents.length ? this.trees.get(this.commits.get(c.parents[0]).tree) : new Map();
    const tree = this.trees.get(c.tree);
    const files = [];
    for (const [path, blob] of tree) {
      if (parentTree.get(path) !== blob) files.push({ path, text: this.blobs.get(blob) });
    }
    this.recorded.push({ sha, parent: c.parents[0] || null, message: c.message, files, external });
  }

  // Test and demo hook: another writer lands a commit, so the board's view goes stale.
  async externalCommit() {
    const parent = this.commits.get(this.head);
    const blob = this._putBlob(`someone else wrote at step ${this._n}\n`);
    const next = new Map(this.trees.get(parent.tree));
    next.set("external-note.txt", blob);
    const tree = this._putTree(next);
    const sha = this._putCommit("sandbox: another writer", tree, [this.head]);
    this._record(sha, true);
    this.head = sha;
    return sha;
  }

  // Current files as {path: text}, for tests.
  snapshotFiles() {
    const t = this.trees.get(this.commits.get(this.head).tree);
    return Object.fromEntries([...t].map(([p, s]) => [p, this.blobs.get(s)]));
  }
}
