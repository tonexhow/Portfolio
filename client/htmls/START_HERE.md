# JPano Portfolio - source checkout

This archive intentionally has exactly four root entries:

```text
client/
server/
database/
.env
```

It uses vanilla HTML, CSS, JavaScript, Go and Supabase. There are no React components or Windows batch files. `dist/` and installed dependencies are generated locally, **not** included.

## First: preserve your working local .env

The `.env` shipped in this ZIP contains **placeholders**, not your old private credentials. Do not accidentally overwrite your existing working `.env` if you want to keep your current database/OAuth/SMTP settings. Save your old `.env` privately, then copy the additional public and KaaBAG settings into it. Never upload or commit your real `.env`.

## Frontend

Use Node.js 20 or newer:

```powershell
cd client/htmls/vercel
npm run check
npm test
npm run build
npx serve dist -l 3000
```

Then open `http://127.0.0.1:3000` (keep the hostname consistent; don't swap localhost and 127.0.0.1 during OAuth).

## Go

Use the Go toolchain required by `server/go.mod` (Go 1.25 or newer):

```powershell
cd server
go test ./...
go vet ./...
go run .
```

Expected local backend: `http://127.0.0.1:48000`, subject to your `.env`.

If KaaBAG is configured, Go can call the private API at `POST /api/v1/chat/completions`. The frontend never receives the API key. The AI completion path does not require an active PostgreSQL connection if a bundled public snapshot is present. Other Go handlers still need their respective database services.

## Public Supabase direct read

`PUBLIC_SUPABASE_URL` is the project's HTTPS URL from **Supabase Dashboard -> Project Settings -> API** (some dashboard layouts put it under Connect/API Keys).

`PUBLIC_SUPABASE_PUBLISHABLE_KEY` is the **publishable** `sb_publishable_...` key (or legacy **anon** key). It is suitable for browser use **only with tightly scoped RLS/RPC permissions**. Do not use `sb_secret_...` or a service-role JWT here.

The read-only `public.jpano_public_snapshot()` and `public.jpano_public_projects()` functions are defined in `database/schema.sql`. Your existing private `portfolio.*` tables remain private and keep their original names. The public RPCs **do not exist in live Supabase until you apply the reviewed schema update**; when absent, public pages continue to use the bundled published snapshot when Go is offline.

Back up the database and test migration behavior in staging before setting `DB_AUTO_MIGRATE=true` and starting Go with live database credentials. Defaults are disabled. No SQL is applied by extracting or building this ZIP.

## Environment keys (without actual values)

| Key | Source / meaning |
| --- | --- |
| `PUBLIC_SNAPSHOT_URL` | Optional exact `https://your-api-domain/api/public/snapshot` for the **build-time** static export. Leave empty to derive from API origin. |
| `PUBLIC_SUPABASE_URL` | Supabase Dashboard project URL such as `https://PROJECT_REF.supabase.co` (browser-public). |
| `PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase project publishable/anon API key (browser-public, subject to database RPC grants). |
| `SUPABASE_URL` | Same Supabase project URL, but used by Go's storage client. |
| `SUPABASE_SECRET_KEY` | Supabase server-side secret/service-role key for restricted storage operations. **Never put in Vercel public config or `config.js`.** |
| `SMTP_TO` | Inbox where management/contact notification emails should be sent, usually your email. It can be the same as `SMTP_EMAIL`. |
| `KAABAG_API_BASE_URL` | Default `https://kaabag.bcc-edu.ph`; set to your actual working KaaBAG deployment. |
| `KAABAG_API_KEY` | Private bearer API key created/managed for your KaaBAG account. Use the key you already tested, if still valid. |
| `KAABAG_MODEL` | Optional model identifier granted to that KaaBAG API key; blank leaves selection to the KaaBAG API default. |

For Vercel, configure **public** build inputs and `PUBLIC_API_BASE_URL` / `API_ORIGIN` in the Vercel project Environment Variables. The local root `.env` is not magically uploaded to Vercel.

## What still depends on Go

Live Chat WebSocket, verified OAuth redirects and cookies, Admin writes and moderation, SMTP notifications, and KaaBAG inference use Go. Guest Bot history stays in local IndexedDB. Published project/certificate/profile information can be served directly from the safe Supabase public RPCs **after those RPCs have actually been applied**, or from the bundled published snapshot. Supabase publishable keys do not by themselves give permission to access private tables or admin data.

## Chat and AI test

After setting `KAABAG_API_KEY`, ask Tonex Bot about a real published project and a professional-experience question. Confirm the answer is based on published facts. Test `switch to dark theme`, `scroll to projects`, and `introduce yourself`; all UI actions use an explicit allowlist.

To share Bot context with a human, visit **Live Chat** and type `/getaichat` as the visitor. This explicitly sends a **summary** of local Bot messages through the Live Chat channel for Admin; local Bot history is not shared by default. If Go is down, Live Chat and online AI are unavailable, but the local published-portfolio assistant remains accessible.

## The `assets/published` and `assets/projects` folders

Both are intentional. `assets/published` contains public offline media/certificate previews generated by the publisher and used by the static snapshot. `assets/projects` contains project preview/placeholder assets. Neither is a duplicate SQL projects table. Removing them breaks offline media.

## Notes on removed tools and documentation

The transient `server/.runtime` directory/PID and obsolete stop/frontend wrappers are not required; the program may create temporary runtime state while running. The old destructive DB cleaning utility was excluded intentionally. A supported, read-only public-data exporter remains in `server/tools/export`; run it manually only if you need to refresh static published assets. Redundant SQL guide/source-notes files were consolidated into the active schema and these instructions.
