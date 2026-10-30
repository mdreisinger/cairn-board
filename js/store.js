// Settings live in localStorage on this device only. Every access is wrapped: storage can be missing or blocked.
const KEY = "cairn-board.settings.v1";
let memory = null; // fallback when storage is unavailable
let usingMemory = false;

export function loadSettings() {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && typeof s.owner === "string" && typeof s.repo === "string" && typeof s.token === "string") return s;
    }
  } catch (e) {
    usingMemory = true;
  }
  return memory;
}

// Returns {persisted: boolean}. When false the values are kept in memory for this page load only.
export function saveSettings(s) {
  memory = s;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(s));
    usingMemory = false;
    return { persisted: true };
  } catch (e) {
    usingMemory = true;
    return { persisted: false };
  }
}

export function clearSettings() {
  memory = null;
  try {
    window.localStorage.removeItem(KEY);
  } catch (e) {
    /* nothing stored that we could clear */
  }
}

export function validSettings(f) {
  const owner = (f.owner || "").trim();
  const repo = (f.repo || "").trim();
  const branch = (f.branch || "").trim() || "main";
  const token = (f.token || "").trim();
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(owner)) return { error: "Owner looks wrong. Use the GitHub login, letters, digits and dashes." };
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(repo)) return { error: "Repo name looks wrong." };
  if (!/^[A-Za-z0-9._/-]{1,100}$/.test(branch)) return { error: "Branch name looks wrong." };
  if (!token) return { error: "Paste a fine-grained token." };
  if (/\s/.test(token)) return { error: "The token has spaces or line breaks in it." };
  return { settings: { owner, repo, branch, token } };
}
