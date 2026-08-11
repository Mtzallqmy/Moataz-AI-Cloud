drop function if exists public.api_runtime_credentials(uuid,uuid,text);
create function public.api_runtime_credentials(p_provider_id uuid,p_model_id uuid,p_backend_secret text)
returns table(id uuid,source text,secret_ref text,encrypted_api_key text,key_mask text,priority integer,base_url text,provider_type text,provider_failover_enabled boolean,credential_strategy text,remote_model_id text,input_cost_per_million numeric,output_cost_per_million numeric)
language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;
  if not private.backend_secret_valid(p_backend_secret) then raise exception 'FORBIDDEN'; end if;
  return query
  select c.id,c.source,c.secret_ref,c.encrypted_api_key,c.key_mask,c.priority,
         p.base_url,p.provider_type,p.failover_enabled,p.credential_strategy,
         m.remote_model_id,m.input_cost_per_million,m.output_cost_per_million
  from public.provider_credentials c
  join public.managed_providers p on p.id=c.provider_id
  join public.provider_models m on m.provider_id=p.id
  where c.provider_id=p_provider_id and m.id=p_model_id and c.enabled and p.enabled and m.enabled
  order by case when p.credential_strategy='round_robin' then c.last_used_at end asc nulls first,c.priority asc,c.created_at asc
  limit 8;
end $$;
revoke all on function public.api_runtime_credentials(uuid,uuid,text) from public,anon;
grant execute on function public.api_runtime_credentials(uuid,uuid,text) to authenticated;
