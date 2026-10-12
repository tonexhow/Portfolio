# JPano Portfolio — Supabase-First Reliability Patch

Source: user-provided `1portfolio-updated.zip`.

## Implemented (no remote mutation performed)

- Corrected Go startup diagnostics: `/api/health` distinguishes process online
  from database access, returns redacted `database_reason` / `database_advice`.
- Optional `DATABASE_POOLER_URL` as an explicit Session Pooler fallback when the
  direct `DATABASE_URL` connection fails. The actual URI must come from Supabase.
- Three-service health levels: **good** = Go + Admin database + recently
  verified KaaBAG AI; **warning** = partial/limited services; **danger** = none
  verified reachable. Tooltip shows Go, DB and AI statuses, and provides
  diagnostics. Admin database is marked public-only if the browser's direct
  Supabase RPC works but Go's Admin database connection is still unavailable.
- Admin Overview no longer labels a reachable Go server as offline solely
  because PostgreSQL is unavailable.
- Tonex Bot fallback has eight varied phrasings for each of nine major intent
  categories. The factual content continues to come from published records;
  no jobs, achievements or private projects are fabricated.
- Added `database/public_read_only_supabase.sql`: optional manual read-only RPC
  setup, with no table-data changes. Also added a lightweight public health RPC
  to `database/schema.sql` for future checks.
- Static Vercel build tries a Supabase published snapshot if Go is unavailable;
  it does not depend exclusively on Go for build-time public data.
- Build copies only published static media files referenced by its selected
  snapshot. Old static files not currently referenced are pruned in the output.
- Supabase Storage setup is read-only on Go startup unless explicitly opted in
  via `STORAGE_AUTO_SETUP=true`. Existing certificate/project handlers still
  prefer Storage and fall back to PostgreSQL blobs when Storage is missing.
- Private values removed from packaged `.env`. **Preserve your real private
  environment and rotate previously exposed secrets before deployment.**

## Important limitations — not yet migrated

The current legacy Admin session system, Admin CRUD, Go WebSocket Live Chat,
feedback/contact writes, PayMongo webhook and SMTP remain Go-dependent. Their
safe Supabase Auth/RLS/Edge Function migration requires real identity and
permission mapping. None of that work was applied to the live project. See
`SUPABASE_FIRST_ROADMAP.md` for the proposed sequence.

A published snapshot cannot revoke old CDN files instantly; redeploy from a
fresh public snapshot and purge old URLs for urgent deletion. Existing legacy
PostgreSQL-only images still require Go or a static copy until moved to Storage.

## Local run

```powershell
# Terminal 1 — from project root
cd client/htmls/vercel
npm install
npm test
npm run build
npx serve dist -l 3000
```

```powershell
# Terminal 2 — from project root
cd server
go mod download
go run .
```

Use Go 1.25+. Before launching Go, merge your rotated private `.env` values
back into the sanitized root template. The supplied package has deliberately
empty `ACCESS_SECRET` and `DATABASE_URL` and will not run fully until they are
configured. Do **not** paste credentials into browser source files.

## Docs

- `server/docs/DATABASE_TROUBLESHOOTING.md`: Admin connection fix guide
- `server/docs/ROUTE_AUDIT.md`: existing API responsibility mapping
- `database/public_read_only_supabase.sql`: reviewable public-read migration
- `client/htmls/MEDIA_LIFECYCLE.md`: Admin uploads, Storage, Vercel media cache
- `client/htmls/SUPABASE_FIRST_ROADMAP.md`: availability and remaining stages
- `client/htmls/TEST_REPORT_2026-10-12.md`: verified/unverified tests
