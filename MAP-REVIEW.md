# TEST map and silhouettes — 22 October 2026

Continues merged PR54 / TEST main `2281496`, on `agent/manager-map-silhouettes`. The new user-supplied map package authorizes a new TEST PR, merge and Pages release after safety checks. Production is outside scope.

## Data and privacy boundary

The application has local worker-name preferences, not an authenticated identity/ACL model. The public map therefore displays **company locations only**. It never reads technician names, work locations, repair archives or protocol arrays. The work layer explicitly says “Bez zjištěné polohy” and explains the missing authorization. No employee coordinates, names or demo employee location dataset are shipped. Switching a presentation role does not authorize access. A pure stable-ID/date projection helper is tested with synthetic records for future authenticated integration; it is not connected to app records or the map.

No GPS, tracking, geocoding, map tiles, external runtime map calls, new service allowlist or backend changes. Existing Plán práce remains available through its original handler; its storage/model were not changed. Real worker mapping requires a separate authenticated internal implementation and reliable worker IDs/work dates.

### Public artifact hardening

The previous build copied a real embedded backup containing worker identities, job locations and photo URLs. That is incompatible with the new no-disclosure requirement. `scripts/build-public-test-data.cjs` now generates an empty operational backup and a positive allowlist of factual technical fields under explicitly anonymized REF identifiers. No actual S/N, customer/owner/place, worker, source protocol file or photo is included in these generated data files. Numerical specifications, model, manufacturer and manufacture year are preserved; the UI clearly marks references as unverified for a concrete serial and does not claim an operational machine state. Existing source data and all original save/import functions are unchanged. Users can import and work with their own records locally, without cloud sync.

The Pages setting was found to be `legacy`, which also publishes the raw repository. Release must change TEST Pages to `workflow` only, so that the prepared allowlisted artifact is authoritative. The raw `protokoly_backup.json` is no longer copied. Historical Git commits/source backups already in the repository are **not purged**; this release prevents their automatic publication in the new Pages artifact, not retroactive erasure from Git history.

## Authoritative public company list

One maintainable list: `LC_COMPANY_LOCATIONS` in `assets/manager-map.js`, 17 non-partner locations, 16 of which explicitly list rental services. Sources and verification dates are stored per location. Coordinates, street and postal data were read directly from `gmap-city-point` attributes on the [official locations page](https://www.zeppelin.cz/kontakty/nase-pobocky). Individual linked location pages were fetched on 22 October 2026; actual service headings determine branch/rental/both. The global navigation was not used to classify rental sites. No person contact details were copied.

Three explicitly marked partner sites (Cheb, Dolní Rychnov, Ostrava MPL) were excluded rather than presented as owned branches. Modletice is not labelled a rental site. Olomouc has official map coordinates but no street on its official page; this is explicitly shown instead of copying an old/unverified address. Duplicate street/postal addresses merge their service tags; unknown coordinates stay in the accessible list outside the map. Closely spaced sites are grouped and listed on selection.

Map outline: Czech polygon extracted from [Natural Earth 1:50m countries](https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_50m_admin_0_countries.geojson), rounded to four decimal places and projected consistently with the company points. [Natural Earth terms](https://www.naturalearthdata.com/about/terms-of-use/) place the vector data in the public domain, including commercial use. Attribution is visible in the map. The entire outline and company list are bundled locally. No invented coordinates, raster tile cache or runtime geocoder.

## UI and compatibility

Home follows the supplied composition with two role entries, uniform real-data figures, limited due/fault/today/work lists and a compact machine selection. Original calendar provides actual date/name day. No photo banner, outside logos, made-up jobs, priority column or decorative numbering. Manager overview combines the map and grouped dates; all original plan/repair paths remain accessible. Technician/Revize do not include the map.

Supplied four SVGs are local illustrative silhouettes, not model drawings. Classification uses explicit device type fields and verified full Czech/English type labels, never model substrings or A/B groups. Unknown, mast, trailer, telehandler and contradictory types use the neutral silhouette. A matching S/N/model/year evidence record can supply an explicit category; known manufacturer conflicts are excluded. The complete machine registry now has filtering and pagination, retaining original card handlers. Photos stay in the detail only; exact S/N photos additionally reject known model/manufacturer/variant/year mismatches. Illustrative fallbacks stay clearly labelled.

Technical parameter/source/year preview logic remains read-only. Original protocol/RZ generator, form data, print CSS, defaults, attachments, compression, QR, save methods and logical storage keys remain unchanged. TEST guard/CSP and storage prefix remain; only the TEST cache version changes to `manager-map-2026-10-22-v4`.

## Validation and review artifacts

Executed Node/isolated Edge suites: manager-map, workspace-ui, test-isolation, technical-sources, machine-passport, dispatch-ui, unchanged-app and inline-syntax. The technical-source suite compares generated RZ HTML and print CSS byte for byte with the original baseline. Tests block external requests; no production writes.

`public-build.test.cjs` verifies zero operational records/photos, anonymized identifiers, excluded personal/source fields, preserved factual parameters, unchanged original data files and actual app rendering of an explicitly read-only public reference. The existing offline-workspaces suite remains a reference-prototype check.

Map tests cover source metadata, site types, duplicate addresses, missing coordinates, last work by stable ID/performed date (not creation date), no disclosure of synthetic worker/place sentinels, no GPS/network/storage API in the new module, layer controls, site details/list and 320/375/390/768/1440 layouts. Registry tests cover filtering and pagination. Photo tests reject a wrong model/manufacturer for a reused serial. Existing regressions cover incomplete form restoration, QR and original action paths.

Ten locally generated `../artifacts/connected-{home,technician,manager,inspector,passport}-{desktop,mobile}.png` use synthetic machine fixtures; an additional manager-map PC/mobile pair includes the unavailable work-location state. No customer photos, worker names or source protocols are published. Tests emulate viewports; no physical phone is claimed.

Release is permitted only to TEST main after these checks. Public build marker: `manager-map-2026-10-22-v4`. Actual PR, merge, workflow and live verification results must be reported after deployment succeeds.

During final verification the separate production checkout acquired concurrent uncommitted changes to its `index.html` (59 additions / 45 deletions). This task did not write that file, revert those changes or copy them into TEST. “Unchanged source” in the regression results refers to the immutable original TEST baseline and the TEST source data hashed before/after building; it is not a claim that other concurrent production work has stopped.
