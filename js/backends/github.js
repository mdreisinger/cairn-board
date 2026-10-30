// GitHubBackend: the Git Data API. One instance per owner/repo/branch/token.
// Interface (shared with DryRunBackend): getRef, getCommit, getTree, getBlob, createBlob, createTree, createCommit, updateRef.
import { BoardError } from "../errors.js";

const API = "https://api.github.com";

export class GitHubBackend {
  constructor({ owner, repo, branch = "main", token, apiBase = API, fetchImpl = (...a) => fetch(...a) }) {
    this.owner = owner;
    this.repo = repo;
    this.branch = branch;
    this.apiBase = apiBase;
    this._token = token;
    this._fetch = fetchImpl;
    this._refEtag = null;
    this._refSha = null;
    this.isDryRun = false;
  }

  _url(path) {
    const o = encodeURIComponent(this.owner);
    const r = encodeURIComponent(this.repo);
    return `${this.apiBase}/repos/${o}/${r}/git/${path}`;
  }

  _branchPath() {
    return this.branch.split("/").map(encodeURIComponent).join("/");
  }

  async _call(method, url, { body, headers = {} } = {}) {
    const h = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: "Bearer " + this._token,
      ...headers,
    };
    if (body !== undefined) h["Content-Type"] = "application/json";
    let res;
    try {
      res = await this._fetch(url, {
        method,
        headers: h,
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: "no-cache",
        credentials: "omit",
        referrerPolicy: "no-referrer",
      });
    } catch (e) {
      throw new BoardError("network", "Can't reach GitHub. Check your connection and try again.");
    }
    if (res.status === 304) return { status: 304, res, json: null };
    let json = null;
    try {
      json = await res.json();
    } catch (e) {
      json = null;
    }
    if (res.ok) return { status: res.status, res, json };
    throw this._failure(method, res, json);
  }

  _failure(method, res, json) {
    const s = res.status;
    const remaining = res.headers.get("x-ratelimit-remaining");
    const apiMsg = json && typeof json.message === "string" ? json.message : "";
    if (s === 401) return new BoardError("auth", "GitHub rejected the token (401). It may be expired or revoked. Sign out and enter a new one.", { status: s });
    if (s === 429 || (s === 403 && (remaining === "0" || /rate limit/i.test(apiMsg)))) {
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      const when = reset ? " It resets at " + new Date(reset * 1000).toLocaleTimeString() + "." : " Wait a few minutes.";
      return new BoardError("ratelimit", "GitHub rate limit reached." + when, { status: s });
    }
    if (s === 403) return new BoardError("forbidden", "The token isn't allowed to do this (403). It needs Contents: read and write on this one repo.", { status: s });
    if (s === 404) return new BoardError("notfound", "GitHub can't find that repo or branch, or the token has no access to it (404). Check owner, repo and branch in Settings.", { status: s });
    if (method === "PATCH" && (s === 409 || s === 422)) {
      return new BoardError("conflict", "The repo changed since the board last read it.", { status: s });
    }
    return new BoardError("api", `GitHub returned ${s}${apiMsg ? ": " + apiMsg.slice(0, 120) : ""}.`, { status: s });
  }

  // fresh: true skips the conditional request (used right before a write).
  async getRef({ fresh = false } = {}) {
    const headers = {};
    if (!fresh && this._refEtag) headers["If-None-Match"] = this._refEtag;
    const r = await this._call("GET", this._url(`ref/heads/${this._branchPath()}`), { headers });
    if (r.status === 304) return { sha: this._refSha, changed: false };
    const sha = r.json && r.json.object && r.json.object.sha;
    if (!sha) throw new BoardError("api", "GitHub returned an unexpected ref.");
    const changed = sha !== this._refSha;
    this._refEtag = r.res.headers.get("etag");
    this._refSha = sha;
    return { sha, changed };
  }

  async getCommit(sha) {
    const r = await this._call("GET", this._url(`commits/${sha}`));
    return { sha, tree: r.json.tree.sha, parents: (r.json.parents || []).map((p) => p.sha) };
  }

  async getTree(sha) {
    const r = await this._call("GET", this._url(`trees/${sha}?recursive=1`));
    if (r.json.truncated) throw new BoardError("api", "The repo tree is too large for the board to read.");
    return r.json.tree.filter((e) => e.type === "blob").map((e) => ({ path: e.path, mode: e.mode, sha: e.sha }));
  }

  async getBlob(sha) {
    const r = await this._call("GET", this._url(`blobs/${sha}`));
    if (r.json.encoding !== "base64") throw new BoardError("api", "Unexpected blob encoding.");
    const bin = atob(r.json.content.replace(/\s/g, ""));
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  }

  async createBlob(text) {
    const r = await this._call("POST", this._url("blobs"), { body: { content: text, encoding: "utf-8" } });
    return r.json.sha;
  }

  async createTree(baseTree, entries) {
    const tree = entries.map((e) => ({ path: e.path, mode: "100644", type: "blob", sha: e.sha }));
    const r = await this._call("POST", this._url("trees"), { body: { base_tree: baseTree, tree } });
    return r.json.sha;
  }

  async createCommit(message, tree, parents) {
    const r = await this._call("POST", this._url("commits"), { body: { message, tree, parents } });
    return r.json.sha;
  }

  async updateRef(sha) {
    await this._call("PATCH", this._url(`refs/heads/${this._branchPath()}`), { body: { sha, force: false } });
    this._refEtag = null;
    this._refSha = sha;
  }
}
