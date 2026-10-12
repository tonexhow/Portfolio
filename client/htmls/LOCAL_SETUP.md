# JPano local and Vercel setup

Source layout: `client/assets`, `client/scripts`, `client/styles`, `client/htmls`.

Static build scripts and Vercel configuration: `client/htmls/vercel/`.

```powershell
cd client/htmls/vercel
npm run check
npm test
npm run build
npx serve dist -l 3000
```

Frontend serves `http://127.0.0.1:3000` and Go runs independently from `server/` with `go run .`.

**Vercel**: set the Project Root Directory to `client/htmls/vercel`, allow source files outside this root in Vercel project settings if required, and use `npm run build` with output directory `dist`. Public environment variables such as `PUBLIC_SUPABASE_URL` and `PUBLIC_SUPABASE_PUBLISHABLE_KEY` must be set in Vercel project settings; your local root `.env` is not deployed.

For Go-independent public reads, install the reviewed, additive public RPCs from `database/schema.sql` and verify they return *only* published data with a Supabase publishable key. Keep service-role credentials on the backend.

The published assets folder holds approved certificate preview images used by the static offline snapshot. The projects folder contains project placeholders/previews. Neither folder is a duplicate of the live projects table.
