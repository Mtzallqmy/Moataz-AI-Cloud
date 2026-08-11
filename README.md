# Moataz AI Cloud

Production-oriented backend, API gateway and owner dashboard for the **Moataz AI** Android application.

## Architecture

```text
Moataz AI Android
  └─ HTTPS + Supabase JWT
      └─ api.moataz.ai / Vercel / Next.js Route Handlers
          ├─ AuthN/AuthZ + quotas + rate limits
          ├─ Managed Provider Gateway (OpenAI-compatible core)
          ├─ Usage accounting + cloud sync
          └─ Supabase
              ├─ PostgreSQL + RLS
              ├─ Auth
              └─ private Storage buckets

Owner browser
  └─ admin.moataz.ai
      └─ Moataz AI Admin (Next.js Server Components + Admin API)
```

Android source code does not belong in this repository. BYOK remains an Android-direct flow and is not charged against managed-cloud quota.

## Stack

- Next.js App Router + TypeScript
- Vercel
- Supabase PostgreSQL, Auth and Storage
- Zod input validation
- Vitest

## Local setup

1. `npm install`
2. Copy `.env.example` to `.env.local`.
3. Fill the Supabase URL, publishable key and `BACKEND_INTERNAL_SECRET` (server-only).
4. Link the Supabase CLI and run migrations from `supabase/migrations/`.
5. `npm run dev`

Never put provider API keys in Git. Never prefix secrets with `NEXT_PUBLIC_`.

## Supabase setup

The migrations create schema, RLS policies, private Storage buckets, quota reservation RPC, default Free/Pro plans and public remote configuration.

```bash
supabase link --project-ref <ref>
supabase db push
```

Create an Auth user for the owner, then promote it using SQL:

```sql
insert into public.admin_users(user_id)
select id from auth.users where email = 'owner@example.com'
on conflict do nothing;
```

Admin authorization is based on `admin_users`, never `user_metadata`.

## Managed providers

Provider records contain non-secret routing metadata. `provider_credentials.secret_ref` contains an environment-variable **name**, e.g. `NVIDIA_API_KEY_1`, never the credential value. The runtime resolves that variable only inside Vercel server code. Multiple enabled credentials are tried in priority order with automatic failover; the schema also supports a `round_robin` strategy.

The common adapter calls OpenAI-compatible `/chat/completions` endpoints and therefore covers OpenAI, NVIDIA, OpenRouter, Groq, Together, Fireworks, DeepInfra and custom compatible endpoints. Provider-specific adapters can be added behind the same abstraction when an API is not compatible.

## Quotas

`reserve_managed_request()` takes a per-user PostgreSQL advisory transaction lock, checks account/provider/model/plan access and rate/request/token ceilings, and inserts a pending usage event. After the provider responds the API writes actual token counts, latency and estimated cost. Pricing is data-driven in `provider_models`, not hard-coded.

Supported limits: requests/minute, daily/monthly requests, daily/monthly tokens, and storage quota. Enforcement is server-side.

## Storage

Private buckets: `avatars`, `attachments`, `documents`, `images`, `audio`.

Object paths start with the authenticated user UUID:

```text
<user_id>/<conversation_id|general>/<uuid>-<safe_filename>
```

RLS on `storage.objects` checks the first folder. `/api/v1/files/upload-url` issues short-lived signed upload URLs after server-side quota validation.

## API

All Android-facing endpoints are versioned under `/api/v1/`. See `docs/android-integration.md` and `docs/openapi.yaml`.

Core routes include config, me, dashboard, usage, providers, models, managed chat/streaming, signed uploads, conversations, and protected `/api/v1/admin/*` operations.

Errors use:

```json
{"error":{"code":"QUOTA_EXCEEDED","message":"Quota exceeded","details":{}}}
```

## Vercel deployment

Required application variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `BACKEND_INTERNAL_SECRET` — long random server-only value whose bcrypt hash is stored in the private database schema
- `APP_BASE_URL`
- `ADMIN_EMAIL`

Provider variables are created only when that provider credential is enabled, e.g. `OPENAI_API_KEY`, `NVIDIA_API_KEY_1`, `NVIDIA_API_KEY_2`, `OPENROUTER_API_KEY`, `GROQ_API_KEY`, `TOGETHER_API_KEY`, `FIREWORKS_API_KEY`, `DEEPINFRA_API_KEY`, `HUGGINGFACE_API_KEY`.

Configure `api.moataz.ai` and `admin.moataz.ai` as domains on the same Next.js project.

## Security model

- RLS enabled on every public application table.
- User data policies use `auth.uid()` ownership.
- No provider secret is stored in PostgreSQL or returned by an endpoint.
- No Supabase elevated/service-role key is required by the application runtime; privileged managed-AI RPCs require the server-only backend trust secret in addition to the authenticated user JWT.
- Admin checks happen server-side against `admin_users`.
- Provider/model disable flags are re-checked for every managed request.
- Sensitive admin changes are written to `admin_audit_logs`.
- Private Storage access is owner-scoped.
- Android cannot enforce or bypass cloud quota.

## Tests

```bash
npm test
npm run lint
npm run build
```

The repository contains unit/security-contract tests plus GitHub Actions CI. Run Supabase security/performance advisors after every schema change.
