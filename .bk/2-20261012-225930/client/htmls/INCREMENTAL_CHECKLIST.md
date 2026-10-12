# Incremental implementation checklist

Status definitions: **DONE = code present and locally checked**; **LOCAL TEST = run on your PC**; **STAGING = requires isolated Supabase/OAuth service test**. Do not mark an integration DONE merely because code compiles.

## Public chat and formatting

- [x] Nested lists, task checkboxes, blockquotes and Markdown code render safely as readable HTML; unsafe raw HTML and protocols escaped.
- [x] CommonMark/GFM subset tests, including task lists, nested quotes, Mermaid source fallback, malicious links.
- [x] Tonex Bot separate from Live Chat; larger desktop chat, mobile full-page chat from earlier work.
- [x] Public Bot actions for project/experience/certificates/contact/career content; typed result cards.
- [x] Allowlisted theme switching and page navigation, no arbitrary code execution.
- [x] Local IndexedDB Bot history and optional explicit `/getaichat` summary handoff.
- [x] KaaBAG private HTTP adapter + controlled, bounded portfolio-grounding request, with published static fallback.
- [ ] LOCAL TEST: KaaBAG real API key, permitted model, response quality, latency, errors and offline transitions.
- [ ] LOCAL TEST: Verify assistant answers employment/restaurant inquiries without adding unsupported experience or confidential projects.
- [ ] LOCAL TEST: Intro portrait, project/certificate/career cards on both themes, mobile scrolling, access-button stacking.
- [ ] LOCAL TEST: Guest/verified Live chat and `/getaichat` in Admin view; no automatic transcript sharing.
- [ ] OPTIONAL: KaTeX, Mermaid diagrams and advanced GFM plugins (currently safe source fallback only).

## Source layout / cleanup

- [x] Exactly root `client/`, `server/`, `database/`, `.env`.
- [x] Client contains only `assets/`, `scripts/`, `styles/`, `htmls/` as direct folders.
- [x] Vercel config/build/worker grouped in `client/htmls/vercel/`.
- [x] Go reusable packages in `server/internal/`; handler files kept in one `main` package so `go run .` remains supported.
- [x] Remove `.bat`, `dist`, `node_modules`, transient PID/.runtime and obsolete destructive utility from archive.
- [x] Keep read-only published-media exporter in `server/tools/export`.
- [x] Keep `assets/published` and `assets/projects` - these are required for offline media.
- [x] Remove obsolete optional RPC/guide/source-note duplicates from `database/`.
- [ ] LOCAL TEST: Existing Admin pages, access/grant/verify local routes, all frontend images, and Vercel deploy from new root path.

## Environment / database

- [x] Main root `.env`; build separates only public, publishable values into `config.js`.
- [x] Client-side Supabase public RPC read attempt + bundled snapshot fallback.
- [x] KaaBAG token and Supabase secret keys kept behind the server, never emitted by build.
- [x] Database's legacy `portfolio.*` tables and old schema version retained; reviewed additive public RPCs prepared in `schema.sql`.
- [x] Default DB setup/migration/storage migration switches remain disabled.
- [ ] LOCAL TEST: Restore your own **private local** `.env` before starting Go; packaged `.env` is sanitized.
- [ ] STAGING: Back up DB, apply additive SQL, confirm anon sees only approved/public records and **cannot** read hidden/private records, chat sessions or contacts.
- [ ] STAGING: Negative tests with a second user, verify RPC grants, data structures, media fallback and automatic migration idempotency.
- [ ] LOCAL TEST: Go 1.25+ full `go test ./...`/`go vet ./...` and Windows run; this runner has Go 1.23 only.
- [ ] LOCAL TEST: KaaBAG streaming **not claimed**; non-streamed completion supported.

## Quality gates

- [x] Syntax checks and frontend static build pass without installing frontend frameworks.
- [x] Unit tests for Markdown, UI command parsing and Go private KaaBAG adapter pass.
- [x] Image/style isolated rendering of nested lists/quotes/code completed.
- [ ] LOCAL TEST: Full browser navigation test in Chromium/Firefox on your PC (automated navigation blocked in this environment).
- [ ] STAGING: Actual Supabase SQL migrations and OAuth providers not executed here.
- [ ] STAGING: Vercel preview validation before switching live website traffic.
