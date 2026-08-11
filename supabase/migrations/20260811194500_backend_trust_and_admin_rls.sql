-- Vercel-to-database trust without a Supabase elevated API key.
create schema if not exists private;
revoke all on schema private from public,anon,authenticated;
create table if not exists private.backend_secrets (
  key text primary key,
  secret_hash text not null,
  created_at timestamptz not null default now()
);
insert into private.backend_secrets(key,secret_hash)
values('vercel_backend','$2a$12$mQkTPcyGJNpJUZeC0zzF0u3tGpYIejijZU0wPjKfGLHazYCiayPZi')
on conflict(key) do update set secret_hash=excluded.secret_hash;

create or replace function private.backend_secret_valid(p_secret text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from private.backend_secrets
    where key='vercel_backend' and secret_hash = extensions.crypt(p_secret, secret_hash)
  );
$$;
revoke all on function private.backend_secret_valid(text) from public,anon,authenticated;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.admin_users where user_id=(select auth.uid()));
$$;
revoke all on function public.is_admin() from public,anon;
grant execute on function public.is_admin() to authenticated;

create policy admin_users_self_select on public.admin_users for select to authenticated using((select auth.uid())=user_id);
create policy admin_profiles_all on public.profiles for all to authenticated using((select public.is_admin())) with check((select public.is_admin()));
create policy admin_plans_all on public.plans for all to authenticated using((select public.is_admin())) with check((select public.is_admin()));
create policy admin_user_plans_all on public.user_plans for all to authenticated using((select public.is_admin())) with check((select public.is_admin()));
create policy admin_providers_all on public.managed_providers for all to authenticated using((select public.is_admin())) with check((select public.is_admin()));
create policy admin_models_all on public.provider_models for all to authenticated using((select public.is_admin())) with check((select public.is_admin()));
create policy admin_credentials_all on public.provider_credentials for all to authenticated using((select public.is_admin())) with check((select public.is_admin()));
create policy admin_provider_access_all on public.provider_plan_access for all to authenticated using((select public.is_admin())) with check((select public.is_admin()));
create policy admin_model_access_all on public.model_plan_access for all to authenticated using((select public.is_admin())) with check((select public.is_admin()));
create policy admin_user_quotas_all on public.user_quotas for all to authenticated using((select public.is_admin())) with check((select public.is_admin()));
create policy admin_usage_all on public.usage_events for select to authenticated using((select public.is_admin()));
create policy admin_conversations_all on public.conversations for select to authenticated using((select public.is_admin()));
create policy admin_messages_all on public.messages for select to authenticated using((select public.is_admin()));
create policy admin_attachments_all on public.attachments for select to authenticated using((select public.is_admin()));
create policy admin_config_all on public.app_config for all to authenticated using((select public.is_admin())) with check((select public.is_admin()));
create policy admin_audit_select on public.admin_audit_logs for select to authenticated using((select public.is_admin()));
create policy admin_audit_insert on public.admin_audit_logs for insert to authenticated with check((select public.is_admin()) and admin_user_id=(select auth.uid()));

create or replace function public.api_allowed_providers()
returns table(id uuid,name text,slug text,description text,provider_type text,default_model_id uuid)
language sql stable security definer set search_path='' as $$
  with current_plan as (
    select plan_id from public.user_plans where user_id=(select auth.uid()) and status='active' order by created_at desc limit 1
  )
  select p.id,p.name,p.slug,p.description,p.provider_type,p.default_model_id
  from public.managed_providers p
  where p.enabled
    and (
      not exists(select 1 from public.provider_plan_access a where a.provider_id=p.id)
      or exists(select 1 from public.provider_plan_access a,current_plan cp where a.provider_id=p.id and a.plan_id=cp.plan_id and a.enabled)
    );
$$;
revoke all on function public.api_allowed_providers() from public,anon;
grant execute on function public.api_allowed_providers() to authenticated;

create or replace function public.api_allowed_models(p_provider_id uuid default null)
returns table(id uuid,provider_id uuid,display_name text,remote_model_id text,capabilities jsonb)
language sql stable security definer set search_path='' as $$
  with current_plan as (
    select plan_id from public.user_plans where user_id=(select auth.uid()) and status='active' order by created_at desc limit 1
  )
  select m.id,m.provider_id,m.display_name,m.remote_model_id,m.capabilities
  from public.provider_models m join public.managed_providers p on p.id=m.provider_id
  where m.enabled and p.enabled and (p_provider_id is null or m.provider_id=p_provider_id)
    and (
      not exists(select 1 from public.model_plan_access a where a.model_id=m.id)
      or exists(select 1 from public.model_plan_access a,current_plan cp where a.model_id=m.id and a.plan_id=cp.plan_id and a.enabled)
    );
$$;
revoke all on function public.api_allowed_models(uuid) from public,anon;
grant execute on function public.api_allowed_models(uuid) to authenticated;

drop function if exists public.reserve_managed_request(uuid,uuid,uuid);
create or replace function public.reserve_managed_request(p_provider_id uuid,p_model_id uuid,p_backend_secret text)
returns uuid language plpgsql security definer set search_path='' as $$
declare p_user_id uuid := (select auth.uid()); v_plan public.plans%rowtype; v_quota public.user_quotas%rowtype; v_id uuid; v_minute int; v_day int; v_month int; v_day_tokens bigint; v_month_tokens bigint;
begin
  if p_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if not private.backend_secret_valid(p_backend_secret) then raise exception 'FORBIDDEN'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  if not exists(select 1 from public.profiles where id=p_user_id and status='active') then raise exception 'ACCOUNT_DISABLED'; end if;
  if not exists(select 1 from public.managed_providers where id=p_provider_id and enabled) then raise exception 'PROVIDER_DISABLED'; end if;
  if not exists(select 1 from public.provider_models where id=p_model_id and provider_id=p_provider_id and enabled) then raise exception 'MODEL_DISABLED'; end if;
  select p.* into v_plan from public.user_plans up join public.plans p on p.id=up.plan_id where up.user_id=p_user_id and up.status='active' and p.enabled order by up.created_at desc limit 1;
  if v_plan.id is null then raise exception 'PLAN_REQUIRED'; end if;
  if exists(select 1 from public.provider_plan_access a where a.provider_id=p_provider_id) and not exists(select 1 from public.provider_plan_access a where a.provider_id=p_provider_id and a.plan_id=v_plan.id and a.enabled) then raise exception 'PLAN_REQUIRED'; end if;
  if exists(select 1 from public.model_plan_access a where a.model_id=p_model_id) and not exists(select 1 from public.model_plan_access a where a.model_id=p_model_id and a.plan_id=v_plan.id and a.enabled) then raise exception 'PLAN_REQUIRED'; end if;
  select * into v_quota from public.user_quotas where user_id=p_user_id and (provider_id=p_provider_id or provider_id is null) order by provider_id nulls last limit 1;
  select count(*) into v_minute from public.usage_events where user_id=p_user_id and created_at>=now()-interval '1 minute';
  select count(*),coalesce(sum(total_tokens),0) into v_day,v_day_tokens from public.usage_events where user_id=p_user_id and created_at>=date_trunc('day',now()) and status in ('pending','success');
  select count(*),coalesce(sum(total_tokens),0) into v_month,v_month_tokens from public.usage_events where user_id=p_user_id and created_at>=date_trunc('month',now()) and status in ('pending','success');
  if coalesce(v_quota.requests_per_minute,v_plan.requests_per_minute) is not null and v_minute>=coalesce(v_quota.requests_per_minute,v_plan.requests_per_minute) then raise exception 'RATE_LIMITED'; end if;
  if coalesce(v_quota.daily_request_limit,v_plan.daily_request_limit) is not null and v_day>=coalesce(v_quota.daily_request_limit,v_plan.daily_request_limit) then raise exception 'QUOTA_EXCEEDED'; end if;
  if coalesce(v_quota.monthly_request_limit,v_plan.monthly_request_limit) is not null and v_month>=coalesce(v_quota.monthly_request_limit,v_plan.monthly_request_limit) then raise exception 'QUOTA_EXCEEDED'; end if;
  if coalesce(v_quota.daily_token_limit,v_plan.daily_token_limit) is not null and v_day_tokens>=coalesce(v_quota.daily_token_limit,v_plan.daily_token_limit) then raise exception 'QUOTA_EXCEEDED'; end if;
  if coalesce(v_quota.monthly_token_limit,v_plan.monthly_token_limit) is not null and v_month_tokens>=coalesce(v_quota.monthly_token_limit,v_plan.monthly_token_limit) then raise exception 'QUOTA_EXCEEDED'; end if;
  insert into public.usage_events(user_id,provider_id,model_id,status) values(p_user_id,p_provider_id,p_model_id,'pending') returning id into v_id; return v_id;
end $$;
revoke all on function public.reserve_managed_request(uuid,uuid,text) from public,anon;
grant execute on function public.reserve_managed_request(uuid,uuid,text) to authenticated;

create or replace function public.api_runtime_credentials(p_provider_id uuid,p_backend_secret text)
returns table(id uuid,secret_ref text,priority int,base_url text,remote_model_id text,input_cost_per_million numeric,output_cost_per_million numeric)
language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;
  if not private.backend_secret_valid(p_backend_secret) then raise exception 'FORBIDDEN'; end if;
  return query select c.id,c.secret_ref,c.priority,p.base_url,m.remote_model_id,m.input_cost_per_million,m.output_cost_per_million
  from public.provider_credentials c join public.managed_providers p on p.id=c.provider_id
  join public.provider_models m on m.provider_id=p.id
  where c.provider_id=p_provider_id and c.enabled and p.enabled and m.enabled order by c.priority,c.created_at;
end $$;
revoke all on function public.api_runtime_credentials(uuid,text) from public,anon;
grant execute on function public.api_runtime_credentials(uuid,text) to authenticated;

create or replace function public.finalize_managed_usage(p_usage_id uuid,p_input_tokens int,p_output_tokens int,p_latency_ms int,p_estimated_cost numeric,p_provider_request_id text,p_status public.usage_status,p_error_code text,p_backend_secret text)
returns void language plpgsql security definer set search_path='' as $$
begin
  if (select auth.uid()) is null then raise exception 'AUTH_REQUIRED'; end if;
  if not private.backend_secret_valid(p_backend_secret) then raise exception 'FORBIDDEN'; end if;
  update public.usage_events set input_tokens=greatest(p_input_tokens,0),output_tokens=greatest(p_output_tokens,0),latency_ms=p_latency_ms,estimated_cost=p_estimated_cost,provider_request_id=p_provider_request_id,status=p_status,error_code=p_error_code
  where id=p_usage_id and user_id=(select auth.uid());
  if not found then raise exception 'NOT_FOUND'; end if;
end $$;
revoke all on function public.finalize_managed_usage(uuid,int,int,int,numeric,text,public.usage_status,text,text) from public,anon;
grant execute on function public.finalize_managed_usage(uuid,int,int,int,numeric,text,public.usage_status,text,text) to authenticated;

grant usage on schema public to authenticated;
grant select on public.profiles,public.plans,public.user_plans,public.managed_providers,public.provider_models,public.usage_events,public.conversations,public.messages,public.attachments,public.app_config,public.admin_users to authenticated;
grant insert,update,delete on public.conversations,public.messages,public.attachments to authenticated;
grant select,insert,update,delete on public.provider_credentials,public.provider_plan_access,public.model_plan_access,public.user_quotas,public.admin_audit_logs to authenticated;
grant insert,update,delete on public.profiles,public.plans,public.user_plans,public.managed_providers,public.provider_models,public.app_config to authenticated;
