-- The application never reads provider_credentials directly from browser-authenticated clients.
-- All credential metadata/secret access is mediated by narrowly scoped SECURITY DEFINER RPCs
-- with admin and/or backend trust-token checks.
drop policy if exists admin_credentials_all on public.provider_credentials;
revoke all on table public.provider_credentials from anon, authenticated;
