// Error kinds the UI knows how to explain. Messages never include the token.
export class BoardError extends Error {
  constructor(kind, message, extra = {}) {
    super(message);
    this.name = "BoardError";
    this.kind = kind; // auth | ratelimit | forbidden | notfound | conflict | network | api | damaged
    Object.assign(this, extra);
  }
}

export function explain(err) {
  if (!(err instanceof BoardError)) return "Something went wrong: " + (err && err.message ? err.message : String(err));
  return err.message;
}

// The text shown when a write did not happen. Always starts with "Not saved".
export function notSaved(err) {
  if (err instanceof BoardError && err.kind === "conflict") return "Not saved. " + err.message + " Nothing was changed.";
  return "Not saved. " + explain(err);
}
