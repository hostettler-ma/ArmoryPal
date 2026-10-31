// Prepares the weekly AI exploratory run: two signed-in players ("alice", an
// admin, and "bob") as Playwright storage-state files the two browser MCP
// servers load, plus a note with their details. Local stack only.
//
//   npx tsx e2e/support/explore-setup.mts http://localhost:3000

import { mkdirSync, writeFileSync } from "node:fs";
import { makeActiveUser } from "./auth-cookies";
import globalSetup from "./global-setup";

const baseURL = process.argv[2] ?? "http://localhost:3000";
const { hostname } = new URL(baseURL);
await globalSetup();
mkdirSync(".explore", { recursive: true });

const players = { alice: await makeActiveUser("Alice", { isAdmin: true }), bob: await makeActiveUser("Bob") };
for (const [key, p] of Object.entries(players)) {
  const state = {
    cookies: p.cookies.map((c) => ({
      ...c,
      domain: hostname,
      path: "/",
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: "Lax" as const,
    })),
    origins: [],
  };
  writeFileSync(`.explore/${key}.json`, JSON.stringify(state));
}

writeFileSync(
  ".explore/players.md",
  [
    `App: ${baseURL}`,
    `This week's event: ${baseURL}/events/${players.alice.eventId}`,
    `- alice: display name "Alice", ADMIN, email ${players.alice.email}`,
    `- bob: display name "Bob", regular player, email ${players.bob.email}`,
    "Both follow the store \"E2E Test Armory\", are going to this week's event and have requested 2× Zeetest Snatch (Red).",
    "Test cards in the catalog: Zeetest Snatch (Red/Yellow/Blue) and Zeetest Sledge (no pitch), plus the full real card catalog.",
  ].join("\n"),
);
console.log("Wrote .explore/alice.json, .explore/bob.json and .explore/players.md");
