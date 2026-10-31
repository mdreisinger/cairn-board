// Loading a snapshot of the data repo and committing a plan through a backend.
import { BoardError } from "./errors.js";

export class Board {
  constructor(backend) {
    this.backend = backend;
    this.blobCache = new Map(); // blob sha -> text. Content-addressed, so it can never be stale.
  }

  async _blob(sha) {
    if (!this.blobCache.has(sha)) this.blobCache.set(sha, await this.backend.getBlob(sha));
    return this.blobCache.get(sha);
  }

  // Reads the branch head fresh and every file the board needs.
  async load() {
    const { sha: head } = await this.backend.getRef({ fresh: true });
    const commit = await this.backend.getCommit(head);
    const tree = await this.backend.getTree(commit.tree);
    const want = tree.filter((e) => /^streams\/[^/]+\.md$/.test(e.path) || e.path === "board.json" || e.path === "INDEX.md");
    const texts = await Promise.all(want.map((e) => this._blob(e.sha)));
    const files = new Map();
    want.forEach((e, i) => files.set(e.path, texts[i]));
    return { head, treeSha: commit.tree, files };
  }

  // Cheap check used by the poll. Uses a conditional request on GitHub.
  async headChanged(snapshot) {
    const r = await this.backend.getRef();
    return r.sha !== snapshot.head;
  }

  // One commit through the Git Data API. Returns the new snapshot. Never forces.
  async commit(plan, snapshot) {
    const { sha: headNow } = await this.backend.getRef({ fresh: true });
    if (headNow !== snapshot.head) {
      throw new BoardError("conflict", "The repo changed since the board last read it.");
    }
    const parent = await this.backend.getCommit(headNow);
    const entries = [];
    for (const ch of plan.changes) {
      entries.push({ path: ch.path, sha: await this.backend.createBlob(ch.text) });
    }
    const tree = await this.backend.createTree(parent.tree, entries);
    const commit = await this.backend.createCommit(plan.message, tree, [headNow]);
    await this.backend.updateRef(commit); // force: false, always
    const files = new Map(snapshot.files);
    for (const ch of plan.changes) files.set(ch.path, ch.text);
    return { head: commit, treeSha: tree, files };
  }
}
