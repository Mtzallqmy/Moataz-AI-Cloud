# Moataz AI Cloud

Production-oriented backend, API gateway and owner dashboard for the **Moataz AI** Android application.

## Architecture

```text
Moataz AI Android
  └─ HTTPS + Supabase JWT
      └─ Vercel / Next.js Route Handlers
          ├─ AuthN/AuthZ + quotas + rate limits
          ├─ Managed Provider Gateway (OpenAI-compatible core)
          ├─ Usage accounting + cloud sync
          └─ Supabase
              ├─ PostgreSQL + RLS
              ├─ Auth
              └─ private Storage buckets

Owner browser
  └─ Moataz AI Admin
      └─ Providers / Models / Plans / Users / Usage / Settings / Audit
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
3. Fill `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `MOATAZ_TRUST_TOKEN`, and `CREDENTIAL_ENCRYPTION_KEY`.
4. `CREDENTIAL_ENCRYPTION_KEY` must be a base64-encoded **32-byte random value** and must remain stable; changing or losing it makes existing database-stored provider credentials undecryptable.
5. Link the Supabase CLI and run migrations from `supabase/migrations/`.
6. `npm run dev`.

Never put provider API keys in Git. Never prefix secrets with `NEXT_PUBLIC_`.

## Supabase setup

Migrations create the relational schema, RLS policies, private Storage buckets, quota reservation/finalization RPCs, Admin authorization, encrypted provider credential metadata, default plans, and remote configuration.

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

## Managed providers and credentials

Providers are dynamic records with `name`, `slug`, `provider_type`, `base_url`, priority, failover settings, plan access, models, and enabled state. The currently implemented transport type is `openai_compatible`, covering OpenAI, NVIDIA NIM, OpenRouter, Groq, Together, Fireworks, DeepInfra, and custom compatible endpoints without hard-coding provider names.

New provider API keys are entered from **Admin → Providers → Add API Credential**. The browser sends the new key once over the authenticated Admin API; the server immediately encrypts it using **AES-256-GCM** with a random 96-bit nonce and provider ID as authenticated additional data. PostgreSQL stores only ciphertext plus a display mask such as `nvapi-••••••••4F9A`. The plaintext key is never returned after save.

Existing environment-variable references remain supported temporarily with `source=environment`. New credentials default to `source=database`; no new NVIDIA/OpenRouter/Groq/etc. environment variable is required.

Credential operations include add, enable/disable, priority, replace/rotate, delete, server-side connection test, health/failure metadata, priority failover, and least-recently-used ordering when `round_robin` is selected. Failover is bounded to at most three credentials per request.

## OpenAI-compatible transport

The common adapter normalizes the configured base URL and appends `/chat/completions` exactly once. For example:

```text
https://integrate.api.nvidia.com/v1
→ https://integrate.api.nvidia.com/v1/chat/completions
```

Connection tests use `{base_url}/models` with a short timeout and never return provider response bodies or authorization headers to the browser. Chat requests have a request timeout, and streaming responses have an idle-read timeout.

## Quotas

`reserve_managed_request()` takes a per-user PostgreSQL advisory transaction lock, checks account/provider/model/plan access and rate/request/token ceilings, and inserts a pending usage event. After the provider responds the API writes actual token counts, latency and estimated cost. Pricing is data-driven in `provider_models`, not hard-coded.

If a provider has no `provider_plan_access` rows, it is available to all plans; this preserves the existing semantics. Quota enforcement remains server-side.

## Storage

Private buckets: `avatars`, `attachments`, `documents`, `images`, `audio`.

Object paths start with the authenticated user UUID:

```text
<user_id>/<conversation_id|general>/<uuid>-<safe_filename>
```

RLS on `storage.objects` checks the first folder. `/api/v1/files/upload-url` issues short-lived signed upload URLs after server-side quota validation.

## API

All Android-facing endpoints remain under `/api/v1/`. See `docs/android-integration.md` and `docs/openapi.yaml`.

Credential administration is server-only under:

```text
GET/POST  /api/v1/admin/credentials
PATCH/DELETE /api/v1/admin/credentials/:id
POST /api/v1/admin/credentials/:id/test
```

Credential responses contain metadata/masked values only and use `Cache-Control: no-store`.

## Vercel deployment

Required application variables:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `MOATAZ_TRUST_TOKEN` — server-only application/database trust secret
- `CREDENTIAL_ENCRYPTION_KEY` — server-only base64-encoded 32-byte AES master key
- `APP_BASE_URL`
- `ADMIN_EMAIL`

Provider API keys should **not** be Vercel Environment Variables for normal operation. Add them from the Admin Dashboard. Environment references are retained only for backward compatibility.

## Security model

- RLS is enabled on every public application table.
- `provider_credentials` has no direct `anon` or `authenticated` table privileges and no direct browser-readable policy.
- Credential metadata and runtime ciphertext are exposed only through narrowly scoped RPCs with Admin and/or backend trust-token checks.
- AES-256-GCM encryption/decryption is implemented in a `server-only` module; the master key is never stored in PostgreSQL.
- Plaintext API keys are not returned in API responses, cookies, local/session storage, URLs, audit logs, or provider error messages.
- No Supabase service-role key is required by the application runtime.
- Admin checks happen server-side against `admin_users`.
- Provider/model disable flags and allowed plans are re-checked server-side for managed requests.
- Sensitive Admin changes are written to `admin_audit_logs` without credential values.
- Private Storage access is owner-scoped.

## Tests

```bash
npm test
npm run lint
npm run build
```

The Vercel production build runs the test suite before the Next.js build. Run Supabase security/performance advisors after schema changes.
