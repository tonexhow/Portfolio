# Database migration protocol

The existing `../schema.sql` is the application's current Go-managed schema definition.

The optional **read-only** published-content Supabase RPCs are in
`../public_read_only_supabase.sql`:

- `public.jpano_public_snapshot()` — published portfolio snapshot
- `public.jpano_public_projects()` — visible published projects only
- `public.jpano_public_health()` — read-only health/revision response

These statements are **not automatically applied to the live Supabase project**.
A database owner must inspect them and apply them in Supabase SQL Editor after
backing up production and verifying table shape, privileges, and published
content filtering. No public role receives direct private-schema access.

To verify in the dashboard SQL editor after authorized installation:

```sql
SELECT public.jpano_public_health();
SELECT jsonb_typeof(public.jpano_public_snapshot());
SELECT jsonb_array_length(public.jpano_public_projects());
```

Also test `anon` access through the Data API, audit for unpublished records,
and check RLS/grants. Do not install new write-capable public RPCs unless their
authorization model is separately reviewed. The Go backend keeps all trusted
writes, payment verification, OAuth secret exchanges, SMTP and AI API keys.
