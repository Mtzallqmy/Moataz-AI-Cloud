create or replace function private.backend_secret_valid(p_secret text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from private.backend_secrets
    where key='vercel_backend'
      and (
        (secret_hash like '$2%' and secret_hash = extensions.crypt(p_secret, secret_hash))
        or
        (secret_hash not like '$2%' and secret_hash = encode(extensions.digest(p_secret,'sha256'),'hex'))
      )
  );
$$;
revoke all on function private.backend_secret_valid(text) from public,anon,authenticated;
-- Set private.backend_secrets.secret_hash to sha256(BACKEND_INTERNAL_SECRET) per environment.
