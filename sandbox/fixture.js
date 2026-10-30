// Invented sandbox data. Every name, task and date here is made up. Nothing in this file comes from a real repo.
// The shape follows the data repo's STANDARDS stream format. INDEX.md is generated with the same port the board uses.
import { generateIndex } from "../js/model.js";

const stream = (title, status, updated, area, where, goal, state, next, waiting, ball, decisions, log) => `# ${title}
status: ${status} · updated: ${updated} · area: ${area}
Where: ${where}

## Now
**Goal:** ${goal}
**State:** ${state}
**Next:**
${next}
**Waiting on / blocked by:** ${waiting}
**Ball:** ${ball}
**Key decisions:** ${decisions}

## Log
${log}
`;

const streams = {
  "garden-shed": stream(
    "Garden shed", "active", "2026-10-28", "home", "notes in the shed folder",
    "Build a small shed for the tools.",
    "Footings are poured and cured. Frame lumber is on order.",
    "- Pick up the lumber\n- Frame the walls",
    "nothing", "me", "Gable roof — simpler to shingle",
    "### 2026-10-28 · abcd1234 · Footings cured\n- Poured on 2026-10-14, checked the level"
  ),
  "kitchen-quote": stream(
    "Kitchen quote", "active", "2026-10-20", "home", "invented-contractor-notes",
    "Get a fixed-price quote for the counter swap.",
    "Measurements sent. Quote not received yet.",
    "- Chase the quote if nothing by the 3rd",
    "the quote", "Pat since 2026-10-20", "Stone or laminate — decide after the quote",
    "### 2026-10-20 · note · Sent measurements\n- Emailed the sketch"
  ),
  "tax-folder": stream(
    "Tax folder", "active", "2026-10-25", "money", "folder on the shelf",
    "Collect the year's paperwork in one place.",
    "Most forms are in. One statement is still missing.",
    "- Ask for the missing statement",
    "the statement", "Lee since 2026-10-25", "Paper copies only for the originals",
    "### 2026-10-25 · note · Asked for the statement\n- Called the office"
  ),
  "book-club": stream(
    "Book club", "active", "2026-10-26", "learning", "-",
    "Pick the next three books.",
    "Shortlist has five titles; a pipe | and a very long line follow: " + "this state is long on purpose so the index has to clip it. ".repeat(4),
    "- Vote on the shortlist\n- Reserve copies",
    "nothing", "none", "One novel, one non-fiction, one wildcard",
    "### 2026-10-26 · note · Shortlist\n- Five titles"
  ),
  "trip": stream(
    "Weekend trip", "paused", "2026-10-10", "travel", "-",
    "Two nights somewhere with trees.",
    "Dates not chosen; parked until the garden shed is done.",
    "- Pick dates",
    "nothing", "none", "Drive, not fly",
    "### 2026-10-10 · note · Parked\n- Waiting on the shed"
  ),
  "trip-prep": stream(
    "Trip packing list", "paused", "2026-10-10", "travel", "-",
    "A packing list that does not need rewriting each time.",
    "Draft list exists.",
    "- Trim the draft",
    "nothing", "Sam since 2026-10-08", "Carry-on only",
    "### 2026-10-10 · note · Parked\n- Draft saved"
  ),
  "old-bike": stream(
    "Old bike sale", "done", "2026-08-01", "home", "-",
    "Sell the old bike.",
    "Sold.",
    "- nothing",
    "nothing", "none", "Sell locally",
    "### 2026-08-01 · note · Sold\n- Handed over"
  ),
  "window-blinds": stream(
    "Window blinds", "done", "2026-10-22", "home", "-",
    "Replace the bedroom blinds.",
    "Installed.",
    "- nothing",
    "nothing", "none", "White, cordless",
    "### 2026-10-22 · note · Installed\n- Done in an hour"
  ),
};

const board = {
  version: 1,
  todos: [
    { id: "t-demo-1", title: "Buy shingles", stage: "backlog", ball: "none", created: "2026-10-27", updated: "2026-10-27" },
    { id: "t-demo-2", title: "Return the ladder", stage: "active", ball: "me", created: "2026-10-26", updated: "2026-10-28" },
    { id: "t-demo-3", title: "Reply about the fence", stage: "active", ball: "Robin since 2026-10-24", created: "2026-10-20", updated: "2026-10-24" },
  ],
};

export function fixtureFiles() {
  const files = {
    "areas.md": "# Areas\n\nInvented areas for the sandbox. Format: `- id — description`.\n\n- home — House and repairs\n- money — Paperwork\n- travel — Trips\n- learning — Reading\n- system — Tooling\n",
    "board.json": JSON.stringify(board, null, 2) + "\n",
  };
  for (const [slug, text] of Object.entries(streams)) files[`streams/${slug}.md`] = text;
  files["INDEX.md"] = generateIndex(files);
  return files;
}
