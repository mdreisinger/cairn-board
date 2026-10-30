// Port of the data repo's bin/scan-secrets.py (scan_line and helpers). Returns rule names and lengths, never values.
// Known difference: JS \w and \b are ASCII-only, Python's are Unicode-aware. Fixtures in tests/unit cover ASCII text.

const SHAPES = [
  ["aws-access-key", /\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[A-Z0-9]{16}\b/g],
  ["github-token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/g],
  ["github-fine-grained-token", /\bgithub_pat_[A-Za-z0-9_]{40,}\b/g],
  ["slack-token", /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g],
  ["npm-token", /\bnpm_[A-Za-z0-9]{30,}\b/g],
  ["api-key-sk", /\bsk-[A-Za-z0-9_-]{20,}/g],
  ["google-api-key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["stripe-key", /\b[sr]k_(?:live|test)_[A-Za-z0-9]{16,}\b/g],
  ["private-key", /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----/g],
  ["jwt", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
  ["bearer-token", /\bbearer\s+[A-Za-z0-9._~+/=-]{20,}/gi],
];

const ASSIGN = new RegExp(
  "\\b(pass(?:word|wd|code|phrase)?|pwd|secret|token|api[_ -]?key|client[_ -]?secret|private[_ -]?key|" +
    "(?:recovery|backup|2fa|otp)[ _-]?codes?)\\b[\"']?\\s*(?::|=|\\bis\\b)\\s*[\"']?([^\\s\"',;)]{6,})",
  "gi"
);
const PIN = /\b(pin|cvv|cvc|security code)\b["']?\s*(?::|=|\bis\b)?\s*["']?(\d{3,8})\b/gi;
const SSN_SHAPE = /(?<![\d-])(\d{3})-(\d{2})-(\d{4})(?![\d-])/g;
const SSN_CTX = /\b(?:ssn|social security(?: number)?)\b\W{0,6}(\d{9})\b/gi;
const CARD = /(?<![\w-])\d(?:[ -]?\d){12,18}(?![\w-])/g;
const KTN_CTX =
  /\b(ktn|known[ -]travell?er(?: number)?|tsa[ -]?pre[✓]?check|global entry|trusted travell?er|traveller number|traveler number|pass ?id)\b/gi;
const POLICY_CTX = /\b(policy|member|subscriber|insurance|quote|claim|group number)\b/i;
const GOVID_CTX = /\b(passport|driver'?s? licen[sc]e|licen[sc]e number|national id|social insurance)\b/gi;
// Python uses an inline (?-i:...) for the code itself. JS does the same by writing the keywords case-insensitively by hand.
const ci = (w) => w.replace(/[a-z]/gi, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`);
const CODE_CTX = new RegExp(
  "\\b(" +
    [ci("confirmation"), ci("booking"), ci("reservation"), ci("record locator"), ci("locator"), ci("pnr"), ci("auth") + "(?:" + ci("orization") + ")?"].join("|") +
    ")\\W{0,3}(?:(?:" +
    [ci("code"), ci("number"), ci("no"), ci("ref") + "(?:" + ci("erence") + ")?", ci("id")].join("|") +
    ")\\b)?\\W{0,3}(?:" + ci("is") + "\\s+)?([A-Z0-9]{6,12})\\b",
  "g"
);
// A UUID (session ids, request ids) is never a policy or traveller number. Context rules see the line with UUIDs blanked.
const UUID = /(?<![0-9A-Za-z])[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}(?![0-9A-Za-z])/g;
const ALNUM = /(?<![\w/.$])([A-Za-z0-9]{6,14})\b(?!\.[A-Za-z])/g;

export function entropy(s) {
  const cps = Array.from(s);
  if (!cps.length) return 0;
  const counts = new Map();
  for (const ch of cps) counts.set(ch, (counts.get(ch) || 0) + 1);
  let h = 0;
  for (const c of counts.values()) h -= (c / cps.length) * Math.log2(c / cps.length);
  return h;
}

export function luhn(digits) {
  let total = 0;
  const rev = [...digits].reverse();
  rev.forEach((ch, i) => {
    let d = Number(ch);
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    total += d;
  });
  return total % 10 === 0;
}

export function cardPrefixOk(d) {
  const n = d.length;
  if (d[0] === "4") return n === 13 || n === 16 || n === 19;
  if (/^(?:5[1-5]|222[1-9]|22[3-9]|2[3-6]\d|27[01]|2720)/.test(d)) return n === 16;
  if (d.slice(0, 2) === "34" || d.slice(0, 2) === "37") return n === 15;
  if (/^(?:6011|65|64[4-9]|622)/.test(d)) return n >= 16 && n <= 19;
  if (/^(?:30[0-5]|36|38|39)/.test(d)) return n === 14 || n === 16;
  if (/^35(?:2[89]|[3-8])/.test(d)) return n >= 16 && n <= 19;
  if (d.slice(0, 2) === "62") return n >= 16 && n <= 19;
  return false;
}

export function isReference(v) {
  if (!v) return true;
  if ("$<{[(%~/\\@#*".includes(v[0]) || v.includes("<") || v.includes(">") || v.includes("{{") || v.includes("${")) return true;
  if (/\.(md|txt|json|pdf|py|sh|yml|yaml)$/i.test(v)) return true;
  const allowed = new Set("*xX.•-_");
  if ([...v].every((c) => allowed.has(c))) return true;
  return false;
}

function looksLikeDate(tok) {
  return /^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(tok);
}

const hasDigit = (s) => /\p{Nd}/u.test(s);
const hasAlpha = (s) => /\p{L}/u.test(s);
const countDigits = (s) => [...s].filter((c) => /\p{Nd}/u.test(c)).length;
const countAlpha = (s) => [...s].filter((c) => /\p{L}/u.test(c)).length;
const len = (s) => Array.from(s).length;

export function scanLine(line) {
  const hits = [];
  for (const [rule, rx] of SHAPES) {
    for (const m of line.matchAll(rx)) {
      if (!isReference(m[0]) || rule === "private-key") hits.push([rule, len(m[0])]);
    }
  }
  for (const m of line.matchAll(ASSIGN)) {
    const v = m[2];
    if (isReference(v)) continue;
    if (hasDigit(v) && hasAlpha(v) && entropy(v) >= 2.8 && len(v) >= 8) hits.push(["password-assignment", len(v)]);
    else if (hasDigit(v) && !hasAlpha(v) && len(v) >= 6 && /^(recovery|backup|2fa|otp)/i.test(m[1])) hits.push(["recovery-code", len(v)]);
  }
  for (const m of line.matchAll(PIN)) {
    const v = m[2];
    const word = m[1].toLowerCase();
    if (word === "pin" && v.length < 4) continue;
    hits.push(["pin-or-cvv", v.length]);
  }
  for (const m of line.matchAll(SSN_SHAPE)) {
    const [, a, g, s] = m;
    if (a !== "000" && a !== "666" && !a.startsWith("9") && g !== "00" && s !== "0000") hits.push(["ssn-shape", len(m[0])]);
  }
  for (const m of line.matchAll(SSN_CTX)) hits.push(["ssn-shape", len(m[1])]);
  for (const m of line.matchAll(CARD)) {
    const digits = m[0].replace(/[ -]/g, "");
    if (digits.length >= 13 && digits.length <= 19 && luhn(digits) && cardPrefixOk(digits) && new Set(digits).size > 1) {
      hits.push(["card-number", digits.length]);
    }
  }
  // Context-based rules below look at the line with UUID-shaped tokens blanked out (same length, so offsets hold).
  line = line.replace(UUID, (u) => " ".repeat(u.length));
  for (const m of line.matchAll(KTN_CTX)) {
    const end = m.index + m[0].length;
    const rest = line.slice(end, end + 60);
    for (const t of rest.matchAll(/(?<![\w$])([A-Za-z0-9]{8,12})\b/g)) {
      const tok = t[1];
      if (countDigits(tok) >= 2 && !isReference(tok)) {
        hits.push(["traveller-number", len(tok)]);
        break;
      }
    }
  }
  for (const m of line.matchAll(GOVID_CTX)) {
    const end = m.index + m[0].length;
    const rest = line.slice(end, end + 40);
    for (const t of rest.matchAll(/(?<![\w$])([A-Za-z0-9]{6,12})\b/g)) {
      const tok = t[1];
      if (countDigits(tok) >= 6 && !isReference(tok)) {
        hits.push(["government-id", len(tok)]);
        break;
      }
    }
  }
  if (POLICY_CTX.test(line)) {
    const seen = new Set();
    for (const t of line.matchAll(ALNUM)) {
      const tok = t[1];
      const digits = countDigits(tok);
      const alpha = countAlpha(tok);
      if (looksLikeDate(tok) || seen.has(tok)) continue;
      const ok = (alpha === 0 && digits >= 7) || (alpha >= 1 && digits >= 5);
      if (ok && !isReference(tok)) {
        seen.add(tok);
        hits.push(["policy-number", len(tok)]);
      }
    }
  }
  for (const m of line.matchAll(CODE_CTX)) {
    const tok = m[2];
    const six = tok.length === 6 && /^\p{L}+$/u.test(tok);
    if ((hasDigit(tok) && hasAlpha(tok)) || six) {
      if (!isReference(tok)) hits.push(["confirmation-code", len(tok)]);
    }
  }
  return hits;
}

export function scanText(text) {
  const out = [];
  text.split("\n").forEach((line, i) => {
    for (const [rule, n] of scanLine(line)) out.push({ line: i + 1, rule, length: n });
  });
  return out;
}

// Added lines between two texts (multiset difference), the way a pre-commit diff scan sees them.
export function addedLines(oldText, newText) {
  const have = new Map();
  for (const l of (oldText || "").split("\n")) have.set(l, (have.get(l) || 0) + 1);
  const added = [];
  for (const l of newText.split("\n")) {
    const c = have.get(l) || 0;
    if (c > 0) have.set(l, c - 1);
    else added.push(l);
  }
  return added;
}

// Returns null when clean, else a masked message.
export function refusalMessage(hits) {
  if (!hits.length) return null;
  const rules = [...new Set(hits.map((h) => h.rule))];
  return `Refused: this looks like a secret (${rules.join(", ")}; value masked). Write where it lives instead of the value. Nothing was saved.`;
}
