# Third-Party Notices

Graywood Reader ("the Software") is licensed under the GNU General Public License
v3.0-or-later (see `LICENSE`). The Software incorporates or builds upon the
following third-party components. Each component remains under its own license
and copyright, and the applicable notices are reproduced or referenced below.

This file is a bill of materials for compliance. It is your responsibility to
preserve these notices in any redistribution of the Software.

---

## 1. Source definitions & parser schemas — kotatsu-parsers

- **Project:** Kotatsu (KotatsuApp/kotatsu-parsers)
- **License:** GNU General Public License v3.0 (GPL-3.0)
- **Location in repo:** `server/sources/catalog.json` & `server/sources/sourcesCatalog.ts` (compiled standalone definitions)
- **Copyright:** © KotatsuApp contributors

The full GPL-3.0 license text is available at `LICENSE`.
Because this GPL-3.0 component is distributed as part of the Software, the
combined work is distributed under GPL-3.0-or-later.

---

## 2. Source-extension abstractions derived from Mihon

- **Project:** Mihon (mihonapp/mihon) — free and open source manga reader for Android
- **License:** Apache License 2.0
- **Copyright:** © 2015 Javier Tomás; © 2024 Mihon Open Source Project
- **SPDX ID:** Apache-2.0
- **Full text:** https://www.apache.org/licenses/LICENSE-2.0

The Software's source-abstraction interface and HTML-scraping template are
inspired by / derived from Mihon's `source-api` module (`Source`, `CatalogueSource`,
`ParsedHttpSource`, model types). Any files copied or adapted retain the Apache-2.0
copyright notice and are marked as modified. Apache-2.0 is compatible with
GPL-3.0-or-later for this distribution.

---

## 3. Reference / interop — Suwayomi-Server

- **Project:** Suwayomi (Suwayomi/Suwayomi-Server) — self-hosted manga server
- **License:** Mozilla Public License 2.0
- **SPDX ID:** MPL-2.0
- **Full text:** https://mozilla.org/MPL/2.0/

If MPL-covered source files (or modifications of them) are incorporated, those
specific files remain available under MPL-2.0 and are identified as such.

---

## 4. Reference / interop — Kotatsu syncserver

- **Project:** Kotatsu-Redo/kotatsu-syncserver
- **License:** GNU General Public License v3.0 (GPL-3.0)
- **Copyright:** © KotatsuApp contributors

Used as a protocol/architecture reference. If its code is copied rather than
re-implemented, the derived files must be distributed under GPL-3.0.

---

## 5. Reference only — Jellyfin (not used in the Software)

- **Project:** jellyfin/jellyfin and jellyfin/jellyfin-web
- **License:** GNU General Public License v2.0 (GPL-2.0)
- **SPDX ID:** GPL-2.0

These are referenced for design/architecture only. No code from these projects
is incorporated into the Software, so no GPL-2.0 obligations are triggered.

---

## 6. npm dependencies

The Software depends on third-party npm packages (see `package.json`). Each
dependency is licensed under its own terms (predominantly MIT, Apache-2.0, BSD-2/3,
ISC). The license texts for installed packages are preserved under
`node_modules/<package>/LICENSE*`. A machine-generated, exhaustive list of
dependency licenses can be produced before release with a tool such as
`license-checker` or `nlf`.

Run the following to generate an exhaustive report before publishing:

```bash
npx license-checker --production --csv --out THIRD-PARTY-NPM.csv
```

---

## Disclaimer

This file is provided for compliance convenience and is not legal advice.
Consult a qualified professional before public release if you have any doubt
about your obligations.