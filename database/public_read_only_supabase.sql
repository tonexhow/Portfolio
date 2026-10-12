-- OPTIONAL MANUAL MIGRATION: no tables or private records are modified.
-- Review before executing in Supabase SQL Editor as database owner.
-- Requires the existing private portfolio schema and published content.
-- Exposes ONLY approved published portfolio records through SECURITY DEFINER RPC.
-- Never expose the portfolio schema in Supabase "Exposed Schemas".
BEGIN;
-- Read-only, published-project Supabase RPC. The private portfolio schema and
-- its table grants remain unchanged. This trusted function exposes ONLY the
-- explicitly listed fields of visible projects, never arbitrary SQL or drafts.
-- Replaces the earlier optional one-off public_projects_rpc_optional.sql.
CREATE OR REPLACE FUNCTION public.jpano_public_projects()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $public_rpc$
  SELECT coalesce(jsonb_agg(
    jsonb_build_object(
      'key', p.id,
      'source', 'database',
      'editable', false,
      'name', p.name,
      'description', p.description,
      'url', p.url,
      'source_url', p.source_url,
      'type', p.type,
      'stack', p.technologies_json,
      'icon', p.icon,
      'images', p.images_json,
      'status', CASE WHEN p.checked_at IS NULL OR p.checked_at < now() - interval '5 minutes'
        THEN 'unknown' ELSE p.status END,
      'checked_at', p.checked_at,
      'visible', true,
      'display_order', p.display_order
    ) ORDER BY p.display_order, p.created_at, p.id
  ), '[]'::jsonb)
  FROM portfolio.projects AS p
  WHERE p.visible = 1;
$public_rpc$;
REVOKE ALL ON FUNCTION public.jpano_public_projects() FROM PUBLIC;
-- Local PostgreSQL may not have Supabase's anon/authenticated roles.
DO $grant_public$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN
    GRANT EXECUTE ON FUNCTION public.jpano_public_projects() TO anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.jpano_public_projects() TO authenticated;
  END IF;
END;
$grant_public$;

-- Supabase Direct Data API: public, read-only portfolio snapshot.
-- It returns only the data already allowed by GET /api/public/snapshot.
-- Keep portfolio private; do NOT expose it as a PostgREST schema.
CREATE OR REPLACE FUNCTION public.jpano_public_snapshot()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $public_snapshot_rpc$
SELECT jsonb_build_object(
  'schema_version',1,
  'revision',(SELECT revision FROM portfolio.sync_state WHERE id=1),
  'updated_at',(SELECT updated_at FROM portfolio.sync_state WHERE id=1),
  'information',(SELECT content FROM portfolio.personal_information WHERE id=1),
  'profiles',jsonb_build_object('items',COALESCE((SELECT content->'profile_images' FROM portfolio.personal_information WHERE id=1),'[]'::jsonb),'rotation_seconds',60),
  'projects',(
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'key',p.id,'source','database','editable',false,'name',p.name,
      'description',p.description,'url',p.url,'source_url',p.source_url,
      'type',p.type,'stack',p.technologies_json,'icon',p.icon,
      'images',p.images_json,'visible',true,'display_order',p.display_order,
      'status','unknown','checked_at',NULL
    ) ORDER BY p.display_order,p.created_at,p.id),'[]'::jsonb)
    FROM portfolio.projects p WHERE p.visible=1
  ),
  'certificates',(
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',c.id,'date',c.certificate_date,'provider',c.provider,'pinned',c.pinned,
      'image_url',CASE WHEN c.storage_url<>'' THEN c.storage_url
        ELSE '/api/public/certificates/'||c.id::text||'/image' END,
      'download_url',CASE WHEN c.storage_url<>'' THEN c.storage_url||'?download'
        ELSE '/api/public/certificates/'||c.id::text||'/download' END
    ) ORDER BY c.pinned DESC,c.certificate_date DESC,c.created_at DESC,c.id DESC),'[]'::jsonb)
    FROM portfolio.certificates c WHERE c.visible=1
  ),
  'feedback',(
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',f.id,'display_name',CASE WHEN f.auth_provider IN ('','legacy') THEN f.display_name
        ELSE left(f.display_name,1)||'***' END,
      'rating',f.rating,'comment',f.comment,'pinned',f.pinned,
      'auth_provider',f.auth_provider,'credential','',
      'created_at',f.created_at,'avatar_url',''
    ) ORDER BY f.pinned DESC,f.created_at DESC,f.id DESC),'[]'::jsonb)
    FROM portfolio.feedback f WHERE f.status='approved'
  ),
  'career_profiles',(
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',d.id,'document_type',d.document_type,'title',d.title,
      'description',d.description,'storage_url',d.storage_url,'file_name',d.file_name,
      'file_size',d.file_size,'display_order',d.display_order,'updated_at',d.updated_at
    ) ORDER BY d.display_order,d.updated_at DESC,d.id DESC),'[]'::jsonb)
    FROM portfolio.career_profiles d WHERE d.visible=1
  )
);
$public_snapshot_rpc$;
REVOKE ALL ON FUNCTION public.jpano_public_snapshot() FROM PUBLIC;
DO $grant_public_snapshot$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='anon') THEN
    GRANT EXECUTE ON FUNCTION public.jpano_public_snapshot() TO anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.jpano_public_snapshot() TO authenticated;
  END IF;
END;
$grant_public_snapshot$;


-- Lightweight public health probe. A successful response proves that the
-- browser's publishable key can execute a trusted function against PostgreSQL.
CREATE OR REPLACE FUNCTION public.jpano_public_health()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog
AS $public_health_rpc$
SELECT jsonb_build_object('status','ready','revision',
    (SELECT revision FROM portfolio.sync_state WHERE id=1));
$public_health_rpc$;
REVOKE ALL ON FUNCTION public.jpano_public_health() FROM PUBLIC;
DO $public_health_grants$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='anon') THEN
    GRANT EXECUTE ON FUNCTION public.jpano_public_health() TO anon;
  END IF;
  IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname='authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.jpano_public_health() TO authenticated;
  END IF;
END;
$public_health_grants$;

COMMIT;
