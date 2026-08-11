create extension if not exists pgcrypto;

create type public.account_status as enum ('active','blocked','pending');
create type public.plan_status as enum ('active','inactive','cancelled','expired');
create type public.usage_status as enum ('pending','success','failed');
create type public.credential_health as enum ('unknown','healthy','degraded','unhealthy');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_path text,
  status public.account_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.plans (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  description text,
  enabled boolean not null default true,
  daily_token_limit bigint,
  monthly_token_limit bigint,
  requests_per_minute integer,
  daily_request_limit integer,
  monthly_request_limit integer,
  storage_quota_bytes bigint not null default 104857600,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.user_plans (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null references public.plans(id), status public.plan_status not null default 'active',
  starts_at timestamptz not null default now(), ends_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index one_active_plan_per_user on public.user_plans(user_id) where status='active';

create table public.managed_providers (
  id uuid primary key default gen_random_uuid(), slug text not null unique, name text not null, description text,
  provider_type text not null, base_url text not null, enabled boolean not null default true,
  credential_strategy text not null default 'priority' check (credential_strategy in ('priority','round_robin')),
  default_model_id uuid, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.provider_models (
  id uuid primary key default gen_random_uuid(), provider_id uuid not null references public.managed_providers(id) on delete cascade,
  display_name text not null, remote_model_id text not null, enabled boolean not null default true,
  capabilities jsonb not null default '[]'::jsonb, input_cost_per_million numeric(18,8), output_cost_per_million numeric(18,8),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(provider_id,remote_model_id)
);
alter table public.managed_providers add constraint managed_providers_default_model_fk foreign key(default_model_id) references public.provider_models(id) on delete set null;
create table public.provider_credentials (
  id uuid primary key default gen_random_uuid(), provider_id uuid not null references public.managed_providers(id) on delete cascade,
  label text not null, secret_ref text not null, enabled boolean not null default true, priority integer not null default 100,
  health_status public.credential_health not null default 'unknown', last_checked_at timestamptz, last_error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(provider_id,secret_ref)
);
create table public.provider_plan_access (
  provider_id uuid not null references public.managed_providers(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete cascade, enabled boolean not null default true,
  daily_token_limit bigint, monthly_token_limit bigint, daily_request_limit integer, monthly_request_limit integer,
  primary key(provider_id,plan_id)
);
create table public.model_plan_access (
  model_id uuid not null references public.provider_models(id) on delete cascade,
  plan_id uuid not null references public.plans(id) on delete cascade, enabled boolean not null default true,
  primary key(model_id,plan_id)
);
create table public.user_quotas (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  provider_id uuid references public.managed_providers(id) on delete cascade,
  daily_token_limit bigint, monthly_token_limit bigint, requests_per_minute integer, daily_request_limit integer, monthly_request_limit integer, storage_quota_bytes bigint,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(user_id,provider_id)
);
create table public.usage_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  provider_id uuid not null references public.managed_providers(id), model_id uuid not null references public.provider_models(id),
  input_tokens integer not null default 0, output_tokens integer not null default 0,
  total_tokens integer generated always as (input_tokens+output_tokens) stored,
  status public.usage_status not null default 'pending', latency_ms integer, estimated_cost numeric(18,8), provider_request_id text, error_code text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index usage_user_created_idx on public.usage_events(user_id,created_at desc);
create index usage_provider_created_idx on public.usage_events(provider_id,created_at desc);

create table public.conversations (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  title text, sync_enabled boolean not null default true, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.messages (
  id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, role text not null check(role in ('system','user','assistant','tool')),
  content jsonb not null default '[]'::jsonb, provider_id uuid references public.managed_providers(id), model_id uuid references public.provider_models(id),
  local_only boolean not null default false, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.attachments (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete cascade, message_id uuid references public.messages(id) on delete set null,
  bucket text not null, path text not null unique, mime_type text, size_bytes bigint not null default 0, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.app_config (
  key text primary key, value jsonb not null, is_public boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(), admin_user_id uuid not null references auth.users(id), action text not null,
  target_type text, target_id text, before_data jsonb, after_data jsonb, ip inet, user_agent text, created_at timestamptz not null default now()
);

create or replace function public.set_updated_at() returns trigger language plpgsql set search_path='' as $$ begin new.updated_at=now(); return new; end $$;
do $$ declare t text; begin foreach t in array array['profiles','plans','user_plans','managed_providers','provider_models','provider_credentials','user_quotas','usage_events','conversations','messages','attachments','app_config'] loop execute format('create trigger %I_updated_at before update on public.%I for each row execute function public.set_updated_at()',t,t); end loop; end $$;

create or replace function public.handle_new_user() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.profiles(id,display_name) values(new.id,coalesce(new.raw_user_meta_data->>'name',split_part(new.email,'@',1)));
insert into public.user_plans(user_id,plan_id) select new.id,id from public.plans where slug='free' and enabled=true limit 1 on conflict do nothing; return new; end $$;
revoke all on function public.handle_new_user() from public,anon,authenticated;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

create or replace function public.reserve_managed_request(p_user_id uuid,p_provider_id uuid,p_model_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_plan public.plans%rowtype; v_quota public.user_quotas%rowtype; v_id uuid; v_minute int; v_day int; v_month int; v_day_tokens bigint; v_month_tokens bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text,0));
  if not exists(select 1 from public.profiles where id=p_user_id and status='active') then raise exception 'ACCOUNT_DISABLED'; end if;
  if not exists(select 1 from public.managed_providers where id=p_provider_id and enabled) then raise exception 'PROVIDER_DISABLED'; end if;
  if not exists(select 1 from public.provider_models where id=p_model_id and provider_id=p_provider_id and enabled) then raise exception 'MODEL_DISABLED'; end if;
  select p.* into v_plan from public.user_plans up join public.plans p on p.id=up.plan_id where up.user_id=p_user_id and up.status='active' and p.enabled order by up.created_at desc limit 1;
  if v_plan.id is null then raise exception 'PLAN_REQUIRED'; end if;
  if exists(select 1 from public.provider_plan_access a where a.provider_id=p_provider_id and a.plan_id=v_plan.id and not a.enabled) then raise exception 'PLAN_REQUIRED'; end if;
  if exists(select 1 from public.model_plan_access a where a.model_id=p_model_id and a.plan_id=v_plan.id and not a.enabled) then raise exception 'PLAN_REQUIRED'; end if;
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
revoke all on function public.reserve_managed_request(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.reserve_managed_request(uuid,uuid,uuid) to service_role;

do $$ declare t text; begin foreach t in array array['profiles','admin_users','plans','user_plans','managed_providers','provider_models','provider_credentials','provider_plan_access','model_plan_access','user_quotas','usage_events','conversations','messages','attachments','app_config','admin_audit_logs'] loop execute format('alter table public.%I enable row level security',t); end loop; end $$;
create policy profiles_self_select on public.profiles for select to authenticated using((select auth.uid())=id);
create policy profiles_self_update on public.profiles for update to authenticated using((select auth.uid())=id) with check((select auth.uid())=id);
create policy plans_read on public.plans for select to authenticated using(enabled=true);
create policy user_plans_self on public.user_plans for select to authenticated using((select auth.uid())=user_id);
create policy providers_read on public.managed_providers for select to authenticated using(enabled=true);
create policy models_read on public.provider_models for select to authenticated using(enabled=true);
create policy usage_self on public.usage_events for select to authenticated using((select auth.uid())=user_id);
create policy conversations_owner_select on public.conversations for select to authenticated using((select auth.uid())=user_id);
create policy conversations_owner_insert on public.conversations for insert to authenticated with check((select auth.uid())=user_id);
create policy conversations_owner_update on public.conversations for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy conversations_owner_delete on public.conversations for delete to authenticated using((select auth.uid())=user_id);
create policy messages_owner_all_select on public.messages for select to authenticated using((select auth.uid())=user_id);
create policy messages_owner_insert on public.messages for insert to authenticated with check((select auth.uid())=user_id);
create policy messages_owner_update on public.messages for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy messages_owner_delete on public.messages for delete to authenticated using((select auth.uid())=user_id);
create policy attachments_owner_select on public.attachments for select to authenticated using((select auth.uid())=user_id);
create policy attachments_owner_insert on public.attachments for insert to authenticated with check((select auth.uid())=user_id);
create policy attachments_owner_update on public.attachments for update to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create policy attachments_owner_delete on public.attachments for delete to authenticated using((select auth.uid())=user_id);
create policy public_config_read on public.app_config for select to anon,authenticated using(is_public=true);

insert into storage.buckets(id,name,public,file_size_limit) values
('avatars','avatars',false,5242880),('attachments','attachments',false,52428800),('documents','documents',false,52428800),('images','images',false,20971520),('audio','audio',false,52428800)
on conflict(id) do nothing;
create policy storage_owner_select on storage.objects for select to authenticated using(bucket_id in ('avatars','attachments','documents','images','audio') and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy storage_owner_insert on storage.objects for insert to authenticated with check(bucket_id in ('avatars','attachments','documents','images','audio') and (storage.foldername(name))[1]=(select auth.uid())::text);
create policy storage_owner_update on storage.objects for update to authenticated using(bucket_id in ('avatars','attachments','documents','images','audio') and (storage.foldername(name))[1]=(select auth.uid())::text) with check((storage.foldername(name))[1]=(select auth.uid())::text);
create policy storage_owner_delete on storage.objects for delete to authenticated using(bucket_id in ('avatars','attachments','documents','images','audio') and (storage.foldername(name))[1]=(select auth.uid())::text);

insert into public.plans(slug,name,description,daily_token_limit,monthly_token_limit,requests_per_minute,daily_request_limit,monthly_request_limit,storage_quota_bytes)
values('free','Moataz Free','Default managed cloud plan',50000,500000,10,200,3000,104857600),('pro','Moataz Pro','Higher limits for managed AI',500000,10000000,60,5000,100000,10737418240)
on conflict(slug) do nothing;
insert into public.app_config(key,value,is_public) values
('minimum_supported_app_version','"1.0.0"',true),('maintenance_mode','false',true),('global_notices','[]',true),('enabled_cloud_features','["managed_chat","cloud_sync","uploads"]',true),('upload_limits','{"avatars":5242880,"attachments":52428800,"documents":52428800,"images":20971520,"audio":52428800}',true)
on conflict(key) do nothing;
