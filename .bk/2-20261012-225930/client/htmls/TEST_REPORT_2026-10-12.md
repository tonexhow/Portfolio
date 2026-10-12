# Reliability patch test report — 2026-10-12

## Automated tests completed

| Test | Result |
|---|---|
| `npm run check` | PASS — 56 source JavaScript files parsed and migration path checks |
| `npm test` | PASS — 37 Node tests, including prior Markdown/security/chat tests plus randomized response variation and snapshot/media safety |
| `npm run build` with Go unavailable | PASS — produces static frontend, keeps published fallback, does not require Go |
| Three-service indicator visual isolated Chromium tests | PASS — good/warning/danger, separate Go/DB/AI rows, viewport-clamped tooltip at desktop and 390 px mobile |
| Partial Admin state with Go+AI online and only public Supabase read | PASS (mock) — warns rather than giving misleading green |
| New Go file syntax | gofmt parse completed; full Go suite **NOT RUN** due missing Go 1.25 toolchain and blocked toolchain DNS |
| Live Supabase PostgreSQL connection, migration, RLS, Auth | NOT RUN — no production database mutation or private-network access |
| KaaBAG production inference | NOT RUN — no private API key available in sanitized package |
| PayMongo live webhook/payment | NOT RUN — test/live credentials and deployment callback required |
| Full end-to-end Browser Admin/Go integration | NOT RUN — only isolated browser UI state mocks and static build |

## Source preservation

- Root ZIP entries: `client/`, `server/`, `database/`, `.env` only.
- No `.git`, `.bat`, `node_modules`, `dist`, local runtime logs or credential
  material included in release ZIP.
- No SQL executed against Supabase; no production data or hosting settings changed.
- `.env` is a **sanitized template**. Keep your real configuration privately;
  copy rotated secret values after extracting.

## Scope not misrepresented as complete

This patch improves public fallback, diagnostics, storage safety, and chat
variety. It **does not** replace the current Admin and Live Chat security model
with Supabase Auth/RLS/Realtime. Do not disable Go for Admin until that
migration is designed, applied to staging, and verified with real accounts.
