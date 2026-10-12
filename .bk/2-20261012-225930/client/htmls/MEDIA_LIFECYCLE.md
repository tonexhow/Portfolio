# Published media, Admin uploads and Vercel static assets

## Where do Admin uploads go today?

- A new certificate/project file is uploaded **to the Go API**, not to Vercel.
- When a valid, explicitly configured **public Supabase Storage bucket** is
  available, Go uploads media to Supabase Storage and stores the URL/path in
  private PostgreSQL (`storage_url`, `storage_path`). This is the preferred path.
- If Supabase Storage is not configured, legacy Go handlers can still store
  the image as `BYTEA` in PostgreSQL. It is *not* copied into your frontend
  source when an Admin clicks Save; however, its image needs Go while offline
  until migrated to Storage or included in a fresh static export.
- The Go server now *checks* Storage bucket configuration without modifying
  policies. `STORAGE_AUTO_SETUP=true` is required for explicit bucket creation
  or making it public. Do not enable it casually on an existing bucket.

## Why are `client/assets/published/certificate-*.png` present?

They are **old build-time published snapshots** for when Go is offline.
They are not a live database and are not synchronized by every Admin update.
The Vercel build copies them only if referenced by the selected public
snapshot. You may retain them locally for emergency offline display.

## If I add a certificate from Admin

1. Go creates its PostgreSQL record, ideally with Supabase Storage URL.
2. With the approved `public.jpano_public_snapshot()` RPC installed, browsers
   can fetch that visible record from Supabase even when Go later stops.
3. New Storage-hosted images work without Go or any Vercel rebuild.
4. A new certificate stored only as PostgreSQL `BYTEA` does **not** have a
   Go-independent image URL. Migrate legacy media before relying on Go-free
   certificate galleries.

## If I hide or delete a certificate from Admin

1. Its database record is hidden/deleted; public RPC will no longer list it.
2. Visitors with network access get the fresh public snapshot automatically.
3. A Vercel deployment built from a fresh Supabase/Go snapshot prunes static
   files that are no longer referenced. **Already-deployed files or CDN caches
   are not revoked immediately**. For urgent removals, redeploy and purge the
   affected asset URL. Do not publish private/revocable documents as immutable
   static assets.
4. If Supabase/Go are both unavailable, an older bundled offline snapshot
   can still show the former record. This is inherent to static fallback data;
   use no static fallback for sensitive content.

## Safe migration order (requires owner approval)

1. Back up your Supabase DB and inspect `portfolio.certificates` and
   `portfolio.project_media` read-only for blank `storage_url` entries.
2. Create/check `portfolio-media` as a public bucket with appropriate MIME/size
   policy. Keep Admin uploads authenticated and validated by Go or an Edge
   Function. Avoid allowing public write access to Storage.
3. Plan an explicit one-time migration using the existing
   `server/internal/storage.MigrateLegacy` logic. Review this code and test
   with a staging bucket before processing production files.
4. Verify every published image's Storage URL and public RPC output.
5. Redeploy from live Supabase data so obsolete static images are excluded.
6. Keep production image changes in Supabase Storage, not `client/assets`.
