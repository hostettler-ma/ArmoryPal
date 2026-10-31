// Prints a Cookie header for a signed-in, active local test user, so the ZAP
// scan can crawl and attack the signed-in pages too. Local stack only.
//
//   npx tsx e2e/support/scan-session.mts

import { makeActiveUser } from "./auth-cookies";
import globalSetup from "./global-setup";

await globalSetup();
const user = await makeActiveUser("ZAP Scanner");
// No spaces: the value is passed through ZAP's whitespace-split -z options.
console.log(user.cookies.map((c) => `${c.name}=${c.value}`).join(";"));
