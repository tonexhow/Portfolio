# JPano Portfolio: Supabase-first availability and migration roadmap

**Current implementation vs. next migration stages.** This document deliberately
distinguishes shipping code from proposed systems; merely providing SQL or a
publishable key does not implement protected Admin authentication.

| Feature | Go offline **today** (after public RPC migration) | Dependency / safe next step |
|---|---|---|
| Static HTML/CSS/JS, navbar, portfolio pages | Yes | Vercel static hosting |
| Published projects, certificates, career and info | Yes | `public.jpano_public_snapshot()` SECURITY DEFINER RPC + browser-safe publishable key |
| Current published images and PDFs in Supabase Storage | Yes | Public Storage bucket and `storage_url` media migration |
| Old PostgreSQL BYTEA images without Storage URL | Only bundled static copies | One-time reviewed media migration; no auto removal |
| Tonex local published-data fallback | Yes | Vercel snapshot/cache |
| KaaBAG generative replies | No | Private trusted gateway (Go or new Supabase Edge Function); KaaBAG host itself must be running |
| Admin dashboard & edits | **No** | Current cookie/OAuth/session model depends on Go+Postgres; migrate to Supabase Auth, allowlisted Admin identities and verified RLS/RPC |
| Admin certificate/project/document upload | **No** | Supabase Auth/RLS + secure Edge Function or Storage write policies |
| Verified Live Chat & WebSocket history | **No** | Replace Go WebSockets with authenticated Supabase Realtime + protected messages; migrate identities/history |
| Visitor feedback/contact writes | **No** | Abuse-protected Edge Functions / Supabase Auth with restrictive inserts |
| SMTP emails | **No** | Edge Function + email provider with server-side secrets |
| PayMongo checkout + signed webhook | **No** | Edge Function hosted checkout + verified raw-body webhook; preserve idempotency and amount checks |
| Existing Go Admin access when its database is unreachable | **No** | Correct `DATABASE_URL`/Session Pooler, base schema and session health |

## Currently shipped in this update

- Go startup database diagnostics without leaking passwords. Optional
  `DATABASE_POOLER_URL` retry if direct PostgreSQL connection fails.
- Three-service health UI: Go, readable database (via Go or authorized public
  Supabase RPC), and verified KaaBAG AI. Green = all 3 online, amber = mixed,
  red = all 3 unavailable; 'Go Admin DB ready' remains separate from
  'browser can read public Supabase data'.
- Published snapshot RPC in `database/public_read_only_supabase.sql`, not
  automatically applied to the live database.
- Vercel build fetches a current published Supabase snapshot if Go is offline,
  then removes static published files no longer referenced by that snapshot.
- Tonex Bot local answers vary phrasing without varying the underlying facts.
- Legacy OAuth, Admin, Go WebSocket Chat and PayMongo behavior are preserved.

## Staged migration to complete the Go-independent Admin architecture

1. **Public read-only stage**: review and apply
   `database/public_read_only_supabase.sql` to a staging copy, confirm anon
   calls return ONLY visible/approved records, and confirm static Vercel
   browsing with Go stopped.
2. **Authenticated identity stage**: provision Supabase Auth, turn on MFA for
   Admin, explicitly allowlist Admin `auth.uid()` values in private records;
   *never* grant Admin based on a browser-provided email or JS flag. Map
   existing visitor OAuth providers and session identities carefully.
3. **Admin data stage**: add least-privilege RLS policies or limited
   SECURITY DEFINER RPCs for each CRUD action, with optimistic concurrency,
   input validation, audit logs, protected documents and storage permissions.
   Verify privilege denial using a normal authenticated (non-Admin) user.
4. **Realtime Live Chat stage**: new authenticated threads/messages with RLS
   by owner/admin, retention, server-side message limits, Realtime channel
   subscriptions, unread counts and authorized history migration. Keep guest
   chat either verified or controlled by rate-limited Edge Functions.
5. **Private services stage**: migrate PayMongo webhooks, SMTP and KaaBAG proxy
   to Edge Functions where limits allow. Keep secrets only in function/server
   environments. Use provider webhook signatures and idempotency keys.
6. **Cutover**: dual-read/compare in staging, then change browser priorities;
   never silently modify production data or invalidate existing Go sessions.
   Preserve Go as optional for specialized workloads.

**Security blocker:** A production-safe Auth/RLS schema and identity mapping
need confirmation of the real `auth.users` and private portfolio tables.
Current source only contains Go-issued Admin cookies and a private
`portfolio` schema; enabling anonymous writes or granting browser service-role
rights is prohibited. For this reason, the full Admin/Live Chat migration is
not falsely presented as complete in this release.
