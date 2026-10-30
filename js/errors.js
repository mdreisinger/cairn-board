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
