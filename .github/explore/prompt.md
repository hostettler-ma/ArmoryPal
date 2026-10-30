You are doing a weekly exploratory test of ArmoryPal, a mobile-first web app for Flesh and Blood TCG players. Players follow their local store, say they're going to its weekly Armory event, list cards they need, and other attendees promise to bring them. Everything updates live for everyone viewing the event. Read `CLAUDE.md` for how the app works and its rules.

A throwaway copy of the app is running at http://localhost:3000 with its own empty database. Nothing you do here affects real users, so be thorough and adversarial. Never visit any other site.

## Your two browsers

You control two separate browsers, each signed in as a different player. Details are in `.explore/players.md`.
- `mcp__alice__*`: Alice, an **admin**, on a phone-sized screen (390×844).
- `mcp__bob__*`: Bob, a regular player, on a desktop screen.

Use both at once to test what one player sees when the other acts. For example, keep Bob on the event page while Alice requests a card, and check that Bob's page updates without a reload.

## What to do (about 45 minutes of work)

1. **Click everything.** Visit every page you can reach. Press every button, open every sheet and tab, and use every form, on both screen sizes. Note anything broken, confusing, misaligned, cut off, unreadable, slow, or inconsistent between the two players.
2. **Check every field.** Try empty, whitespace-only, very long, emoji, non-Latin, negative, zero, decimal and huge values. Does the app accept bad input or reject good input? Are the error messages clear?
3. **Check the rules in CLAUDE.md as a user would.** For example: try to pledge more than is needed, lower a request below what's pledged, act on an event you're not going to, or leave an event while you're bringing cards. Check that notifications say the right thing to the right person.
4. **Attack it like a malicious player:**
   - As Bob, try to reach admin pages and act on Alice's requests.
   - Tamper with URLs, ids and hidden form fields.
   - Put HTML or script into names and notes, then see how it renders for the other player.
   - Try open redirects through `?next=`.
   - Try to read other users' data through http://127.0.0.1:54321/rest/v1 with the publishable key from the page source.
5. **Note what the existing tests in `e2e/` don't cover yet.**

Skip email sign-in (magic links): it's switched off and not in use yet. Sign-in is Discord-only, which can't run here, so both browsers start signed in.

Don't spend more than a few minutes on any one thing. If a page is broken, note it and move on.

## Report

Write your findings to `explore-report.md` in the repo root. Use this format and nothing else:

```
## Summary
One or two sentences: overall state, and the single most important finding.

## Findings
For each finding, most serious first:
### <short title>
- **Severity:** Security / Bug / UX / Nit
- **Where:** page or component
- **Steps:** numbered steps to reproduce
- **Expected / actual:**
- **Suggested fix:** one or two lines, referencing files if you looked at the code

## Not covered by the automated tests
Bullet list of flows or checks worth adding to e2e/.

## What I tried that worked fine
Short bullet list, so the next run can go deeper elsewhere.
```

Only report problems you actually saw happen, and say exactly how to reproduce each one. If you found nothing in a category, say so. Don't change any files except `explore-report.md`.
