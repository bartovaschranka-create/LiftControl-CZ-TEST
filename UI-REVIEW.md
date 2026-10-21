# Offline review — 21. 10. 2026

Continuation of draft PR #54, branch `agent/workspace-role-navigation`, TEST repository only. PR #53 is already in the local baseline `fa32e1d`; no duplicate passport integration. The new reference package supersedes the earlier three-role home proposal. The earlier connected presentation remains unchanged pending visual approval; this iteration adds an isolated prototype, not a replacement deployment.

## Scope and evidence

| Requirement | Result |
| --- | --- |
| Two operational entries, no inspector tile | Offline home contains only Technician and Manager. Original revision workspace untouched. |
| No priority in summaries | No priority column or indicator in prototype; historical fields untouched. |
| Uniform aggregate figures | Computed color, size and weight asserted identical. |
| Reference composition | Horizontal brand/navigation, warm paper, dark role entries, yellow actions, two-thirds main content and narrow summary/work column. No sidebar, third-party logo or decorative photos. |
| Subcards | Seven technician and six manager tabs, local search and technical passport navigation. Unsupported user administration omitted. |
| Identity/calendar | Explicit unauthenticated example; date generated in browser, current name day copied from original Czech calendar by builder. No duplicate calendar. |
| Synthetic fixtures | DEMO identifiers and example models only. No real backup, customer, photograph or technical value imported. |
| Firebase isolation | CSP connect-src none; no Firebase/import/storage code; browser test aborts all requests and asserts none occurred. |
| RZ/forms/storage | New prototype is not loaded by index.html. Original source regression against fixed pre-redesign baseline passes. |
| Responsive | All three views checked at 320/375/390/768/1280/1440; every subcard also checked on mobile. |
| Keyboard | Native buttons, input and visible focus; tab navigation and search by Enter exercised. |
| Publication | Draft PR only. No merge, deployment or workflow trigger. |

Changed files in this iteration: `preview/workspaces.html`, `tests/offline-workspaces.test.cjs`, this review and `CODEX-NEXT.md`. No changes to original JS, CSS, service worker, backend configuration, photos, forms or RZ. Existing TEST client still uses shared `doctype-test`; therefore the live TEST app is not a safe sandbox for writes. Only the separate offline prototype is used here.

## Validation

Executed with Node and Playwright/Edge:

```
node tests/offline-workspaces.test.cjs
node tests/unchanged-app.test.cjs
git diff --check
```

Offline test passes: three HTML files, six PNG, all viewport checks, tabs, search, passport/back, demo action feedback, keyboard, zero network requests and page errors. Edge needs execution outside the restricted process sandbox; first restricted launch failed, rerun succeeded. Original app regression passes. No cloud operation was exercised.

Local artifacts are generated in `../artifacts/`: `workspace-home.html`, `workspace-technician.html`, `workspace-manager.html` and each matching `-desktop.png` / `-mobile.png`. Review server: http://127.0.0.1:4191/ (local machine only). Run the test to regenerate. Images were visually inspected for desktop Manager and mobile Technician; all six captured successfully.

## Limits / approval gate

These are synthetic-data presentation prototypes. Buttons demonstrate navigation or explicitly explain that the action is offline; no original form opens. Technical values, photos and envelope are marked unavailable. Original integration still contains the earlier three-mode navigation and is not this new design. After visual approval, adapt the existing presentation module to this layout, preserve the original revision access and wire existing actions only. Do not merge this draft as a finished application redesign.
