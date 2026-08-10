-- Canary for migration 045 asset_live_transfer. Self-cleaning.
begin;

do $$
declare
  preview_exists boolean;
  transfer_exists boolean;
  rls_preview boolean;
  rls_transfer boolean;
  anon_preview boolean;
  anon_transfer boolean;
begin
  select exists(
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'asset_transfer_previews'
  ) into preview_exists;
  select exists(
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'asset_transfers'
  ) into transfer_exists;

  if not preview_exists or not transfer_exists then
    raise exception 'ASSET_LIVE_TRANSFER_TABLES_MISSING';
  end if;

  select relrowsecurity into rls_preview
    from pg_class where oid = 'public.asset_transfer_previews'::regclass;
  select relrowsecurity into rls_transfer
    from pg_class where oid = 'public.asset_transfers'::regclass;

  if not rls_preview or not rls_transfer then
    raise exception 'ASSET_LIVE_TRANSFER_RLS_DISABLED';
  end if;

  select has_table_privilege('anon', 'public.asset_transfer_previews', 'SELECT')
    into anon_preview;
  select has_table_privilege('anon', 'public.asset_transfers', 'SELECT')
    into anon_transfer;

  if anon_preview or anon_transfer then
    raise exception 'ASSET_LIVE_TRANSFER_ANON_EXPOSED';
  end if;
end;
$$;

rollback;
