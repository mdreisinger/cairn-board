import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const CAIRN_DIR = process.env.CAIRN_DIR || resolve(here, "../../../cairn");
export const haveCairn = existsSync(join(CAIRN_DIR, "bin", "lint.py")) && existsSync(join(CAIRN_DIR, "bin", "scan-secrets.py"));
export const SKIP = haveCairn ? false : "set CAIRN_DIR to a checkout of the data repo (needs bin/lint.py and bin/scan-secrets.py)";

export function writeTree(files, dir) {
  dir = dir || mkdtempSync(join(tmpdir(), "board-test-"));
  for (const [p, t] of Object.entries(files)) {
    const full = join(dir, p);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, t);
  }
  return dir;
}
export const cleanup = (d) => rmSync(d, { recursive: true, force: true });

const PY_INDEX = `
import importlib.util, sys
spec = importlib.util.spec_from_file_location("lint", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
sys.stdout.write(m.generate_index(sys.argv[2]))
`;
export function pythonIndex(root) {
  return execFileSync("python3", ["-I", "-c", PY_INDEX, join(CAIRN_DIR, "bin", "lint.py"), root], { encoding: "utf-8" });
}

const PY_SCAN = `
import importlib.util, sys, json
spec = importlib.util.spec_from_file_location("scan", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
lines = json.load(sys.stdin)
json.dump([[ [r, n] for r, n in m.scan_line(l)] for l in lines], sys.stdout)
`;
export function pythonScan(lines) {
  const out = execFileSync("python3", ["-I", "-c", PY_SCAN, join(CAIRN_DIR, "bin", "scan-secrets.py")], { input: JSON.stringify(lines), encoding: "utf-8", maxBuffer: 1 << 26 });
  return JSON.parse(out);
}

export function runLint(root) {
  try {
    const out = execFileSync(join(CAIRN_DIR, "bin", "lint.sh"), ["--root", root], { encoding: "utf-8" });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status, out: String(e.stdout) + String(e.stderr) };
  }
}

const J = (a) => a.join("");
// Secret shapes are assembled at runtime so no source file holds one.
const UUID_A = J(["3f2b8c1e", "-9a4d-", "4e7b-", "8c11-", "2d5f6a7b8c9d"]);
const UUID_B = J(["0a1b2c3d", "-4567-", "89ab-", "cdef-", "012345678901"]);
export const POSITIVES = [
  ["policy-number", "- 2026-10-30 10:00 · " + UUID_A + " · cloud · \"renters quote\" → insurance-renters-auto — compared policy " + J(["COA", "323", "309"])],
  ["traveller-number", "KTN " + UUID_B + " " + J(["TT", "1234567"]) + "9"],
  ["aws-access-key", J(["AK", "IA", "ABCDEFGH", "IJKLMNOP"])],
  ["github-token", J(["gh", "p_", "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8"])],
  ["github-fine-grained-token", J(["github", "_pat_", "11AAAAAAA0abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGH"])],
  ["slack-token", J(["xo", "xb-", "1234567890-abcdefghij"])],
  ["private-key", J(["-----BEGIN ", "RSA PRIVATE", " KEY-----"])],
  ["jwt", J(["ey", "Jhbgcioijiuzi1nij9", ".", "ey", "Jzdwiioixmjm0nta", ".", "abcDEF123456xyz"])],
  ["bearer-token", J(["Bear", "er ", "abcdefghij0123456789ABCD"])],
  ["card-number", "card " + J(["4111", "1111", "1111", "1111"])],
  ["ssn-shape", "ssn " + J(["123", "-45-", "6789"])],
  ["traveller-number", "KTN " + J(["TT", "1234567"]) + "9"],
  ["traveller-number", "TSA PreCheck KTN " + J(["AB", "CDEFG", "H1", "2"])],
  ["policy-number", "policy " + J(["COA", "323", "309"])],
  ["password-assignment", J(["pass", "word"]) + "=" + J(["Zx9", "Qm4", "Lp7", "Rw2"])],
  ["pin-or-cvv", J(["P", "IN "]) + "4821"],
  ["confirmation-code", "booking code is " + J(["QX7", "LM2", "P"])],
  ["government-id", "passport " + J(["X", "12345", "678"])],
  ["recovery-code", J(["recovery", " code: "]) + "48215930"],
];
export const NEGATIVES = [
  "- 2026-10-30 10:00 · " + UUID_A + " · cloud · \"renters quote\" → insurance-renters-auto — compared options",
  "KTN note for session " + UUID_B,
  "member claim logged in " + UUID_B + " and " + UUID_A,
  "password=$DB_PASSWORD",
  "password: <your password>",
  "token: in the password manager under Progressive",
  "policy documents are in iCloud Drive/Records/Insurance",
  "card ending 1001, Visa 7449",
  "card " + J(["4111", "1111", "1111", "1112"]),
  "call 855-798-5735 about the policy",
  "premium $1,597.50 paid 10/26/2026",
  "see memory/areas/policy20261030.md for the policy",
  "epoch 1761849600000",
  "commit 9ed5423 on main",
  "Buy shingles",
  "Reply about the fence to Robin",
  "",
];
