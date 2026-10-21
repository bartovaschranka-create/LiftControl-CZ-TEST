# UI review — 21 October 2026

PR #54, branch agent/workspace-role-navigation, TEST repository only. PR #53 is already merged in baseline fa32e1d. User approved the isolated visual prototype and then authorized existing functions and descriptions to be connected and pushed to TEST GitHub. Latest user-supplied complete PR54 instruction explicitly authorizes merge and public TEST Pages deployment after isolation verification.

## Implemented

- Approved two-entry operational home, dark Technician/Manager launch surfaces, warm paper, horizontal navigation, yellow accents and compact real-data summaries.
- Technician and Manager subcards call existing control, fault, repair, history, documents, QR, plan and audit functions. Original form DOM, fields, suggestions, photos and defaults retained.
- Separate **Revize** entry visible beside settings and in tools; revision workspace has new/draft/saved/history/protocol-print-export paths and machine documentation, without operational quick actions. It is not a third operational role tile and does not claim authorization.
- Summaries use identical anthracite figure typography. No priority displayed by the new operational views; underlying fault fields untouched. Due-date groups use documented control/revision dates and original machine references. No invented technical figures.
- Existing name-day calendar reused; local worker identity remains explicitly unverified. No fake login or unsupported user administration.

## Isolation from production

Both local source configurations still point to doctype-test. A distinct repository does not isolate that backend, and GitHub Pages projects can also share browser storage by origin. Therefore this TEST build deliberately operates in **local-only mode**:

1. assets/test-isolation.js runs before original scripts. Firebase cannot initialize. Original save routines use their unchanged local fallbacks.
2. A CSP blocks cross-origin connections, including Firestore, cloud storage uploads and external API calls. SDK scripts from gstatic are not allowed. Read-only image loading is retained for existing photos.
3. localStorage and sessionStorage expose a TEST-prefixed namespace, including enumeration, remove and clear. Original unprefixed production keys are neither imported nor modified. No migration of earlier shared local data.
4. TEST service worker activation deletes only obsolete TEST-prefixed caches. Offline lookups use its own cache, never another application's cached index.
5. Workflow copies the guard into the static artifact; push trigger remains main only. Deployment is authorized only after all required safety checks pass.

Consequences: test edits remain on that browser and do not sync with colleagues. External API-backed lookups are blocked; existing local technical data/document links remain available. A separate Firebase project would be required for safe shared-cloud testing. This guard does not change an already-deployed older TEST build until the new code is deployed; use the isolated local URL during review.

## Files / preservation

Presentation: assets/workspace-ui.js, assets/workspace-ui.css. Safety: assets/test-isolation.js, two early index.html inserts, sw.js cache isolation, one workflow copy line. Tests and this documentation updated. Production source/repository, Firebase config/rules, original save functions, record models, attachments, RZ generator, RZ fields and original print CSS untouched. The final UI removes decorative section numbers, reduces each working menu to four focused categories and keeps only three short task summaries on home. The machine passport has three focused areas (parameters/envelopes, history, documentation/photos), expanded read-only aliases, source conflict reporting and explicit missing transport data. Imported TEST technical evidence has 239 source rows. Production source was inspected read-only for field aliases; no production customer records or hardcoded model defaults were copied. Model preferences are labelled as orientation only. Infolinka remains a plain external link; no API integration is claimed.

The earlier reference-only prototype remains at preview/workspaces.html; it is not imported into the app.

## Executed validation

Node with Playwright/isolated Edge, external network requests aborted by test routing:

- node tests/workspace-ui.test.cjs — navigation, original control/archive/QR/revision actions, separate inspector, real draft selection, form suspension/resume, passport, identical summary typography, no record mutations; 320/375/390/768/1440 layouts.
- node tests/technical-sources.test.cjs — conflicting technical values displayed with sources, manufacturer/variant filtering, explicit persons/wind, missing transport data, no auto 12.5 m/s, no data mutation; RZ HTML and print CSS byte-identical to original baseline.
- node tests/test-isolation.test.cjs — original saveProtocol and revision local-save routines succeed in isolated storage; Firebase SDK cannot initialize; attempted cloud POST is blocked; production-sentinel local/session data survive test clear; simulated worker activation preserves production and unrelated caches.
- node tests/machine-passport.test.cjs — manufacturing-year preview, unknown identity, modal fallback, photo provenance, envelope escaping and original action routing.
- node tests/dispatch-ui.test.cjs — original suggestions/photo inputs/forms/navigation and mobile/tablet/desktop presentation.
- node tests/unchanged-app.test.cjs — after removing explicit presentation/safety insertions, entire original app source equals immutable pre-redesign baseline, including RZ and saving logic.
- node tests/inline-syntax.test.cjs; node --check assets/workspace-ui.js; git diff --check.

All passed. No live backend writes or Firebase rules operation performed. Restrictive process sandbox cannot launch Edge; browser tests were run with approved local process escalation.

## Review locations

Functional isolated app: http://127.0.0.1:4192/ (local machine only). Existing synthetic reference gallery remains http://127.0.0.1:4191/ and is not the connected app.

Local artifacts: ../artifacts/connected-{home,technician,manager,inspector,passport}-{desktop,mobile}.png, generated with test data; ten PNGs. Earlier six reference mockup PNGs remain workspace-{home,technician,manager}-{desktop,mobile}.png. Desktop home and mobile inspector visually inspected after functional integration. Screenshots stay local; no customer-data images published to GitHub.

## Deployment gate

User explicitly requests merge of PR #54 only into TEST main, followed by GitHub Pages deployment and live verification. No production repository, configuration, rules or data may be modified. The deployed TEST build must expose LIFTCONTROL_TEST_BUILD = pr54-2026-10-21-v3 and retain all isolation guards. Cache version is TEST-only isolated-workspaces-v3. Deployment result will be reported with the actual workflow URL and merge SHA, not inferred from a push.
