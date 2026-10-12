# JPano update — Markdown, service notices, introductions, schema startup

- Live Chat and Admin Chat render valid two-dash GFM tables, including left/right alignment.
- Safe Markdown links are clickable. Dangerous links are displayed as blocked labels; raw `<script>` markup stays inert. Runnable HTML/CSS/JS remains opt-in only inside sandboxed preview fences.
- Public service indicator now refers to Server, Database and AI Assistant without technology names or environment-variable suggestions. Diagnostic codes remain available in server logs and Admin views.
- Intro messages use current published portfolio information, rotate message phrasing, and include an authenticated first-party introduction card with randomly selected published portraits.
- Go supports direct PostgreSQL over IPv6 and an exact Supabase Session Pooler URL for IPv4. Either connection may be used alone; startup attempts both in order if provided.
- Schema alignment checks required tables/columns and migration markers before running idempotent additive SQL. No portfolio content is seeded. `DB_AUTO_MIGRATE=true` is set in the included local template; review and back up production before deploying.
- KaaBAG's model field is optional in the Go adapter; PayMongo webhook signing secret must be obtained from the PayMongo webhook endpoint.

**Limitations:** Real Supabase permissions/connectivity, live PayMongo webhooks and the full Go 1.25 test suite were not verified in this environment. Static frontend checks and JavaScript tests were run.
