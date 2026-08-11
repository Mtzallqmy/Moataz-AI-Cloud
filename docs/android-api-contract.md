# Moataz AI Cloud — Android API Contract (Current Code)

> **Source of truth:** this document describes the API that exists in the current `Mtzallqmy/Moataz-AI-Cloud` `main` branch. It intentionally distinguishes implemented behavior from planned behavior. No provider API keys or server secrets are exposed here.

## 1. Base URLs

### Moataz Cloud production

Current verified Vercel production base:

```text
https://moataz-ai-cloud.vercel.app/api/v1
```

All paths in the Android-facing section are relative to that base.

The previously planned custom domain `https://api.moataz.ai` is not part of the current deployed contract unless DNS/Vercel domains are configured separately.

### Supabase Auth

Current Supabase project:

```text
https://kjmqzmjgvueenzpqjefe.supabase.co
```

Auth base:

```text
https://kjmqzmjgvueenzpqjefe.supabase.co/auth/v1
```

Android must use the Supabase **publishable** key, never a service-role/elevated key.

---

## 2. Common Cloud API rules

### Authentication header

Every protected Moataz Cloud endpoint requires the Supabase **access token**:

```http
Authorization: Bearer <supabase_access_token>
```

For JSON requests:

```http
Content-Type: application/json
Accept: application/json
```

Do **not** send the Supabase refresh token to Moataz Cloud. The backend validates the access token with Supabase Auth and checks the user's profile status on every protected request.

### Common error envelope

Moataz Cloud errors use:

```json
{
  "error": {
    "code": "AUTH_REQUIRED",
    "message": "Bearer token required",
    "details": {}
  }
}
```

Known cloud error codes in the current codebase:

```text
AUTH_REQUIRED
ACCOUNT_DISABLED
PROVIDER_DISABLED
MODEL_DISABLED
PLAN_REQUIRED
QUOTA_EXCEEDED
RATE_LIMITED
STORAGE_LIMIT
PROVIDER_ERROR
INVALID_CREDENTIAL
INVALID_MODEL
PROVIDER_UNAVAILABLE
PROVIDER_TIMEOUT
CONFIGURATION_ERROR
CONFLICT
INTERNAL_ERROR
NOT_FOUND
FORBIDDEN
VALIDATION_ERROR
```

Validation failures use HTTP `422`, for example:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed",
    "details": {
      "issues": [
        {
          "path": "provider_id",
          "message": "Invalid UUID"
        }
      ]
    }
  }
}
```

Unhandled database/runtime errors become HTTP `500` with `INTERNAL_ERROR`; stack traces are not returned to the client.

---

# 3. Supabase Authentication / Session

There are **no** `/api/v1/login`, `/api/v1/signup`, `/api/v1/refresh`, or `/api/v1/logout` routes in Moataz Cloud. Android authenticates directly with Supabase Auth and then sends the resulting access-token JWT to Moataz Cloud.

The current web Admin login also uses Supabase email/password auth, confirming that Supabase Auth is the active identity system.

## 3.1 Login — email/password

**Status:** READY  
**Android needed:** Yes

Recommended Android operation using Supabase Kotlin:

```kotlin
supabase.auth.signInWith(Email) {
    email = "user@example.com"
    password = "password"
}
```

Equivalent HTTP contract:

**Method:** `POST`

**Path:**

```text
https://kjmqzmjgvueenzpqjefe.supabase.co/auth/v1/token?grant_type=password
```

**Authentication:** no user session required.

**Headers:**

```http
apikey: <SUPABASE_PUBLISHABLE_KEY>
Content-Type: application/json
```

**Request:**

```json
{
  "email": "user@example.com",
  "password": "correct-horse-battery-staple"
}
```

**Typical successful response:**

```json
{
  "access_token": "eyJ...redacted",
  "token_type": "bearer",
  "expires_in": 3600,
  "expires_at": 1786472400,
  "refresh_token": "refresh-token-redacted",
  "user": {
    "id": "11111111-1111-1111-1111-111111111111",
    "email": "user@example.com",
    "role": "authenticated"
  }
}
```

Exact Supabase user/session fields may contain additional auth metadata.

**Errors:** Supabase Auth native error format; common cases include invalid credentials, unconfirmed email (depending on project Auth settings), rate limiting, and disabled/deleted user.

**Streaming:** No.  
**Pagination:** No.

## 3.2 Sign up

**Status:** READY at Supabase Auth level  
**Android needed:** Yes if self-registration is enabled in product UX.

Recommended Kotlin:

```kotlin
supabase.auth.signUpWith(Email) {
    email = "user@example.com"
    password = "strong-password"
}
```

Equivalent HTTP:

**Method:** `POST`

**Path:**

```text
https://kjmqzmjgvueenzpqjefe.supabase.co/auth/v1/signup
```

**Headers:**

```http
apikey: <SUPABASE_PUBLISHABLE_KEY>
Content-Type: application/json
```

**Request:**

```json
{
  "email": "user@example.com",
  "password": "strong-password",
  "data": {
    "name": "Moataz User"
  }
}
```

`data` is optional.

**Response:** Supabase Auth user/session response. Whether a usable session is returned immediately or email confirmation is required depends on the Supabase project's Auth configuration; the application code does not override that setting.

The database has an `auth.users` trigger that creates:
- a `profiles` row;
- an active Free plan assignment when the `free` plan is available.

**Streaming:** No.  
**Pagination:** No.

## 3.3 Access token

The Supabase access token is a short-lived JWT. Android sends it to Moataz Cloud exactly as:

```http
Authorization: Bearer <access_token>
```

Do not put it in query parameters, logs, analytics payloads, or crash-report text.

## 3.4 Refresh token / token refresh

**Status:** READY through Supabase Auth.

Recommended Kotlin:

```kotlin
val session = supabase.auth.refreshCurrentSession()
```

or, with an explicit refresh token:

```kotlin
val session = supabase.auth.refreshSession(refreshToken = storedRefreshToken)
```

Supabase may rotate refresh tokens. Android must atomically replace both the access token and refresh token after refresh.

Recommended behavior:
1. Refresh before access-token expiry.
2. If Moataz Cloud returns `401 AUTH_REQUIRED`, refresh once.
3. Retry the original Cloud request once after a successful refresh.
4. If refresh fails, clear local session and require login again.

## 3.5 Logout

**Status:** READY through Supabase Auth.

Recommended Kotlin:

```kotlin
supabase.auth.signOut()
```

After logout remove access token, refresh token, and user-specific cached Cloud data. There is no Moataz Cloud logout endpoint.

---

# 4. Account / Me

## GET `/me`

**Method:** `GET`  
**Full path:** `https://moataz-ai-cloud.vercel.app/api/v1/me`  
**Authentication:** Required.

**Headers:**

```http
Authorization: Bearer <access_token>
Accept: application/json
```

**Request body:** none.

**Response:**

```json
{
  "user": {
    "id": "11111111-1111-1111-1111-111111111111",
    "email": "user@example.com",
    "display_name": "Moataz User",
    "status": "active",
    "avatar_path": null,
    "created_at": "2026-08-11T12:00:00.000Z"
  },
  "plan": {
    "id": "22222222-2222-2222-2222-222222222222",
    "slug": "free",
    "name": "Moataz Free",
    "description": "Default managed cloud plan",
    "enabled": true,
    "daily_token_limit": 50000,
    "monthly_token_limit": 500000,
    "requests_per_minute": 10,
    "daily_request_limit": 200,
    "monthly_request_limit": 3000,
    "storage_quota_bytes": 104857600,
    "created_at": "2026-08-11T12:00:00.000Z",
    "updated_at": "2026-08-11T12:00:00.000Z"
  },
  "status": "active",
  "quota": {
    "daily_tokens": 1200,
    "monthly_tokens": 9000,
    "daily_requests": 4,
    "monthly_requests": 31,
    "storage_bytes": 2048
  }
}
```

**Nullable / optional fields:** `display_name`, `avatar_path`, `plan`, plan limit columns, and potentially `email` for non-email identities.

**Important current behavior:** `quota` is **not a quota-limit object**. It is the same usage summary returned by `/usage`. Actual plan ceilings are inside `plan`, and per-user quota overrides are not returned here.

**Errors:** `401 AUTH_REQUIRED`, `403 ACCOUNT_DISABLED`, `500 INTERNAL_ERROR`.  
**Streaming:** No.  
**Pagination:** No.

---

# 5. Dashboard

## GET `/dashboard`

**Method:** `GET`  
**Full path:** `https://moataz-ai-cloud.vercel.app/api/v1/dashboard`  
**Authentication:** Required.

**Headers:**

```http
Authorization: Bearer <access_token>
Accept: application/json
```

**Request body:** none.

**Response:**

```json
{
  "account": {
    "id": "11111111-1111-1111-1111-111111111111",
    "email": "user@example.com",
    "display_name": "Moataz User",
    "status": "active",
    "avatar_path": null
  },
  "plan": {
    "id": "22222222-2222-2222-2222-222222222222",
    "slug": "free",
    "name": "Moataz Free",
    "description": "Default managed cloud plan",
    "enabled": true,
    "daily_token_limit": 50000,
    "monthly_token_limit": 500000,
    "requests_per_minute": 10,
    "daily_request_limit": 200,
    "monthly_request_limit": 3000,
    "storage_quota_bytes": 104857600,
    "created_at": "2026-08-11T12:00:00.000Z",
    "updated_at": "2026-08-11T12:00:00.000Z"
  },
  "quota": {
    "daily_tokens": 1200,
    "monthly_tokens": 9000,
    "daily_requests": 4,
    "monthly_requests": 31,
    "storage_bytes": 2048
  },
  "usage": {
    "daily_tokens": 1200,
    "monthly_tokens": 9000,
    "daily_requests": 4,
    "monthly_requests": 31,
    "storage_bytes": 2048
  },
  "storage": {
    "bytes_used": 2048
  },
  "providers": [
    {
      "id": "33333333-3333-3333-3333-333333333333",
      "name": "Moataz NVIDIA",
      "slug": "nvidia",
      "description": "Managed NVIDIA NIM",
      "provider_type": "openai_compatible",
      "default_model_id": "44444444-4444-4444-4444-444444444444"
    }
  ]
}
```

**Important current behavior:** `quota` and `usage` are currently identical usage-summary objects. The route does not expose the effective per-user quota override.

**Errors:** `401 AUTH_REQUIRED`, `403 ACCOUNT_DISABLED`, `500 INTERNAL_ERROR`.  
**Streaming:** No.  
**Pagination:** No.

---

# 6. Remote Config

## GET `/config`

**Method:** `GET`  
**Full path:** `https://moataz-ai-cloud.vercel.app/api/v1/config`  
**Authentication:** Not required.  
**Request body:** none.

**Headers:**

```http
Accept: application/json
```

**Response shape:** all public `app_config` rows are returned as dynamic key/value entries.

```json
{
  "config": {
    "minimum_supported_app_version": "1.0.0",
    "maintenance_mode": false,
    "global_notices": [],
    "enabled_cloud_features": ["managed_chat", "cloud_sync", "uploads"],
    "upload_limits": {
      "avatars": 5242880,
      "attachments": 52428800,
      "documents": 52428800,
      "images": 20971520,
      "audio": 52428800
    }
  }
}
```

Values are arbitrary JSON and may be string/boolean/number/array/object/null depending on Admin settings.

**Errors:** `500 INTERNAL_ERROR`.  
**Streaming:** No.  
**Pagination:** No.

---

# 7. Managed Providers

## GET `/providers`

**Method:** `GET`  
**Full path:** `https://moataz-ai-cloud.vercel.app/api/v1/providers`  
**Authentication:** Required.

**Headers:**

```http
Authorization: Bearer <access_token>
Accept: application/json
```

**Request body:** none.

**Response:**

```json
{
  "providers": [
    {
      "id": "33333333-3333-3333-3333-333333333333",
      "name": "Moataz NVIDIA",
      "slug": "nvidia",
      "description": "Managed NVIDIA NIM",
      "provider_type": "openai_compatible",
      "default_model_id": "44444444-4444-4444-4444-444444444444"
    }
  ]
}
```

**Server-side filtering:** disabled providers are excluded; active plan access is checked. No plan-access rows means provider available to all plans; otherwise the active plan needs an enabled access row.

**Current return coverage:** provider id yes; display name yes; models no; explicit `enabled` no (presence implies enabled); capabilities no; explicit plan restrictions no; quota no; API keys/secrets never.

**Nullable:** `description`, `default_model_id`.  
**Errors:** `401 AUTH_REQUIRED`, `403 ACCOUNT_DISABLED`, `500 INTERNAL_ERROR`.  
**Streaming:** No.  
**Pagination:** No.

---

# 8. Models

## GET `/models`

**Method:** `GET`  
**Full path:** `https://moataz-ai-cloud.vercel.app/api/v1/models` or `https://moataz-ai-cloud.vercel.app/api/v1/models?provider=<provider_uuid>`  
**Authentication:** Required.

**Headers:**

```http
Authorization: Bearer <access_token>
Accept: application/json
```

**Query:** `provider` is optional. It is not independently Zod-validated in the current route.

**Request body:** none.

**Response:**

```json
{
  "models": [
    {
      "id": "44444444-4444-4444-4444-444444444444",
      "provider_id": "33333333-3333-3333-3333-333333333333",
      "display_name": "Llama 3.3 70B",
      "remote_model_id": "meta/llama-3.3-70b-instruct",
      "capabilities": ["text", "streaming"]
    }
  ]
}
```

**Filtering:** only enabled models under enabled providers and permitted by the active plan are returned. No model-plan rows means available to all plans.

**Not returned:** explicit model enabled flag, allowed-plan list, pricing, provider credentials.

**Errors:** `401 AUTH_REQUIRED`, `403 ACCOUNT_DISABLED`, malformed provider query values may surface as `500 INTERNAL_ERROR`, plus `500 INTERNAL_ERROR`.  
**Streaming:** No.  
**Pagination:** No.

---

# 9. Managed Chat

## POST `/chat`

**Method:** `POST`  
**Full path:** `https://moataz-ai-cloud.vercel.app/api/v1/chat`  
**Authentication:** Required.

**Headers:**

```http
Authorization: Bearer <access_token>
Content-Type: application/json
Accept: application/json
```

**Request:**

```json
{
  "provider_id": "33333333-3333-3333-3333-333333333333",
  "model_id": "44444444-4444-4444-4444-444444444444",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "Hello"}
  ],
  "temperature": 0.7,
  "max_tokens": 1024,
  "conversation_id": "55555555-5555-5555-5555-555555555555"
}
```

Required: `provider_id` UUID, `model_id` UUID, non-empty `messages`. Each parsed message contains only `role: string` and `content: any JSON value`.

Optional: `temperature` range 0..2, positive integer `max_tokens`, `conversation_id` UUID.

### Current chat feature matrix

| Feature | Support | Reality in current code |
|---|---|---|
| system messages | YES | role/content forwarded |
| user messages | YES | |
| assistant history | YES | |
| images / OpenAI multimodal content arrays | PARTIAL | arbitrary `content` passes through; no validation or file resolver |
| attachment IDs | NO | no `attachments` field |
| tool definitions (`tools`) | NO | top-level schema has no tools; unknown fields are stripped |
| `tool_choice` | NO | |
| assistant `tool_calls` | NO proper contract | message parser preserves only role/content |
| tool results with `tool_call_id` | NO proper contract | same limitation |
| streaming | Separate route | `/chat/stream` |
| usage/token counts | YES if upstream returns standard usage | persisted server-side too |
| `conversation_id` | YES | non-streaming only |
| automatic cloud save | PARTIAL | saves last request content as user message + first assistant response content |

**Response:** successful upstream OpenAI-compatible JSON is returned directly, not wrapped in a Moataz-specific DTO.

```json
{
  "id": "chatcmpl-provider-id",
  "object": "chat.completion",
  "created": 1786469000,
  "model": "meta/llama-3.3-70b-instruct",
  "choices": [
    {
      "index": 0,
      "message": {"role": "assistant", "content": "Hello! How can I help?"},
      "finish_reason": "stop"
    }
  ],
  "usage": {"prompt_tokens": 18, "completion_tokens": 7, "total_tokens": 25}
}
```

Provider-specific extra fields can be present.

**Server enforcement:** authentication → account → plan/provider/model/quota/rate limit reservation → credential selection/failover → provider → usage finalization → optional conversation save.

**Errors:** `401 AUTH_REQUIRED`, `403 ACCOUNT_DISABLED`, `403 PLAN_REQUIRED`, `403 PROVIDER_DISABLED`, `403 MODEL_DISABLED`, `403 FORBIDDEN`, `422 VALIDATION_ERROR`, `422 INVALID_MODEL`, `429 QUOTA_EXCEEDED`, `429 RATE_LIMITED`, `502 INVALID_CREDENTIAL`, `502 PROVIDER_ERROR`, `503 PROVIDER_UNAVAILABLE`, `504 PROVIDER_TIMEOUT`, `500 CONFIGURATION_ERROR`, `500 INTERNAL_ERROR`.

**Streaming:** No.  
**Pagination:** No.

---

# 10. Streaming Chat

## POST `/chat/stream`

**Method:** `POST`  
**Full path:** `https://moataz-ai-cloud.vercel.app/api/v1/chat/stream`  
**Authentication:** Required.

**Headers:**

```http
Authorization: Bearer <access_token>
Content-Type: application/json
Accept: text/event-stream
```

**Request:**

```json
{
  "provider_id": "33333333-3333-3333-3333-333333333333",
  "model_id": "44444444-4444-4444-4444-444444444444",
  "messages": [{"role": "user", "content": "Write a short greeting."}],
  "temperature": 0.7,
  "max_tokens": 256
}
```

Required: `provider_id`, `model_id`, non-empty `messages`. Optional: `temperature`, `max_tokens`. `conversation_id` is **not supported** by this route.

**Protocol:** SSE-compatible upstream forwarding.

```http
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-store, no-transform
Connection: keep-alive
```

Typical events:

```text
data: {"id":"...","choices":[{"delta":{"role":"assistant"}}]}

data: {"id":"...","choices":[{"delta":{"content":"Hello"}}]}

data: [DONE]
```

The route forwards provider chunks and does not define a separate Moataz event schema. Android must parse SSE `data:` records, tolerate provider-specific fields, and treat abrupt termination as failure. Provider stream reads have an approximately 60-second idle timeout.

Usage is finalized from standard streamed `usage` fields when present, but the Cloud route does not add a custom final usage event.

**Important current inconsistency:** streaming explicitly maps reservation `RATE_LIMITED` and `QUOTA_EXCEEDED`, but does not map every reservation error before streaming. Some `PLAN_REQUIRED`, `PROVIDER_DISABLED`, or `MODEL_DISABLED` database failures can surface as `500 INTERNAL_ERROR` on this route.

After HTTP 200 has begun, failures can terminate the stream; a JSON error envelope cannot reliably be emitted at that point.

**Streaming:** SSE.  
**Pagination:** No.

---

# 11. Usage and Quota

## GET `/usage`

**Method:** `GET`  
**Full path:** `https://moataz-ai-cloud.vercel.app/api/v1/usage`  
**Authentication:** Required.

**Headers:**

```http
Authorization: Bearer <access_token>
Accept: application/json
```

**Request body:** none.

**Response:**

```json
{
  "daily_tokens": 1200,
  "monthly_tokens": 9000,
  "daily_requests": 4,
  "monthly_requests": 31,
  "storage_bytes": 2048
}
```

Current calculation: successful usage rows only; day begins at UTC midnight; month begins UTC first day; request counts equal successful usage rows; token values sum `total_tokens`; `storage_bytes` sums `attachments.size_bytes`, not actual Storage object bytes.

Not returned: input/output split, provider/model breakdown, history, effective user quota overrides, remaining quota.

**Errors:** `401 AUTH_REQUIRED`, `403 ACCOUNT_DISABLED`, `500 INTERNAL_ERROR`.  
**Streaming:** No.  
**Pagination:** No.

## Dedicated quota endpoint

There is **no** Android-facing `/quota` endpoint. Plan limits are available in `/me.plan` and `/dashboard.plan`; effective `user_quotas` overrides are enforced but not exposed.

---

# 12. Storage / Files

Private buckets: `avatars`, `attachments`, `documents`, `images`, `audio`.

Generated path:

```text
<user_uuid>/<conversation_uuid_or_general>/<random_uuid>-<sanitized_filename>
```

## POST `/files/upload-url`

**Method:** `POST`  
**Full path:** `https://moataz-ai-cloud.vercel.app/api/v1/files/upload-url`  
**Authentication:** Required.

**Headers:**

```http
Authorization: Bearer <access_token>
Content-Type: application/json
Accept: application/json
```

**Request:**

```json
{
  "bucket": "images",
  "conversation_id": "55555555-5555-5555-5555-555555555555",
  "filename": "photo.jpg",
  "size_bytes": 123456
}
```

`conversation_id` optional. `bucket` must be one of the five private buckets. Filename length 1..180. `size_bytes` positive integer.

**Response:**

```json
{
  "bucket": "images",
  "path": "11111111-1111-1111-1111-111111111111/55555555-5555-5555-5555-555555555555/66666666-6666-6666-6666-666666666666-photo.jpg",
  "token": "signed-upload-token",
  "signed_url": "https://kjmqzmjgvueenzpqjefe.supabase.co/storage/v1/upload/sign/..."
}
```

Android can use Supabase Storage `uploadToSignedUrl(path, token, data/file)`.

**Errors:** `401 AUTH_REQUIRED`, `403 ACCOUNT_DISABLED`, `403 STORAGE_LIMIT`, `422 VALIDATION_ERROR`, `500 INTERNAL_ERROR`.  
**Streaming:** bytes upload directly to Supabase Storage, not through this Cloud route.  
**Pagination:** No.

### Current storage limitations

1. No Android Cloud endpoint creates an `attachments` row after a signed upload succeeds.
2. Therefore `usage.storage_bytes` may not match actual Supabase Storage bytes.
3. No Cloud endpoint creates a signed private download URL.
4. No Cloud endpoint deletes a file.
5. No Cloud endpoint lists files/attachments.
6. Chat has no attachment-ID resolver.

Storage is **PARTIAL** for Android.

---

# 13. Conversations / Cloud Sync

## GET `/conversations`

**Method:** `GET`  
**Full path:** `https://moataz-ai-cloud.vercel.app/api/v1/conversations`  
**Authentication:** Required.  
**Request body:** none.

**Response:**

```json
{
  "conversations": [
    {
      "id": "55555555-5555-5555-5555-555555555555",
      "user_id": "11111111-1111-1111-1111-111111111111",
      "title": "Trip ideas",
      "sync_enabled": true,
      "created_at": "2026-08-11T12:00:00.000Z",
      "updated_at": "2026-08-11T12:05:00.000Z"
    }
  ]
}
```

`title` nullable. Ordered `updated_at DESC`.

**Errors:** `AUTH_REQUIRED`, `ACCOUNT_DISABLED`, `INTERNAL_ERROR`.  
**Streaming:** No.  
**Pagination:** No; all matching conversations are returned.

## POST `/conversations`

**Method:** `POST`  
**Authentication:** Required.

**Request:**

```json
{
  "title": "Trip ideas",
  "sync_enabled": true
}
```

Both fields optional. `title` max 200 and nullable in DB. `sync_enabled` defaults true.

**Response:** HTTP `201`

```json
{
  "id": "55555555-5555-5555-5555-555555555555",
  "user_id": "11111111-1111-1111-1111-111111111111",
  "title": "Trip ideas",
  "sync_enabled": true,
  "created_at": "2026-08-11T12:00:00.000Z",
  "updated_at": "2026-08-11T12:00:00.000Z"
}
```

**Errors:** `AUTH_REQUIRED`, `ACCOUNT_DISABLED`, `VALIDATION_ERROR`, `INTERNAL_ERROR`.  
**Pagination:** No.

## GET `/conversations/{id}`

**Method:** `GET`  
**Authentication:** Required.

**Example:** `https://moataz-ai-cloud.vercel.app/api/v1/conversations/55555555-5555-5555-5555-555555555555`

**Response:**

```json
{
  "id": "55555555-5555-5555-5555-555555555555",
  "user_id": "11111111-1111-1111-1111-111111111111",
  "title": "Trip ideas",
  "sync_enabled": true,
  "created_at": "2026-08-11T12:00:00.000Z",
  "updated_at": "2026-08-11T12:05:00.000Z",
  "messages": [
    {
      "id": "77777777-7777-7777-7777-777777777777",
      "conversation_id": "55555555-5555-5555-5555-555555555555",
      "user_id": "11111111-1111-1111-1111-111111111111",
      "role": "user",
      "content": "Hello",
      "provider_id": null,
      "model_id": null,
      "local_only": false,
      "created_at": "2026-08-11T12:01:00.000Z",
      "updated_at": "2026-08-11T12:01:00.000Z"
    }
  ]
}
```

Message `role` DB values: `system | user | assistant | tool`. `content` is non-null JSON. `provider_id` and `model_id` nullable. `local_only` non-null boolean.

**Errors:** `401 AUTH_REQUIRED`, `403 ACCOUNT_DISABLED`, `404 NOT_FOUND`, `500 INTERNAL_ERROR`.  
**Messages pagination:** No.

## DELETE `/conversations/{id}`

**Method:** `DELETE`  
**Authentication:** Required.  
**Request body:** none.  
**Success:** `204 No Content`.

Deletion is scoped to the authenticated user. The current route does not distinguish already-missing from deleted; both can result in 204.

---

# 14. Messages

There is **no** `/api/v1/messages` route and no `/api/v1/conversations/{id}/messages` route.

Current message creation only occurs indirectly: successful non-streaming `/chat` with `conversation_id` inserts a user and assistant message. Streaming does not accept `conversation_id` and does not persist streamed chat messages. No Cloud endpoint exists for arbitrary system/tool/manual synced message CRUD.

---

# 15. Provider selection and quota semantics

Android should use:

```text
GET /providers
  ↓ provider.id
GET /models?provider=<provider.id>
  ↓ model.id
POST /chat or /chat/stream
```

Do not hard-code database UUIDs.

Allowed-plan semantics: no provider/model access rows means allowed for all plans; if access rows exist, the active plan needs an enabled row.

Server-side request reservation enforces active account, active plan, provider/model enabled state, plan access, requests/minute, daily/monthly request limits, and daily/monthly token limits. Android local checks are advisory only.

---

# 16. ADMIN ONLY - DO NOT INTEGRATE INTO ANDROID

All routes below require server-side Admin authorization against `admin_users`. Do not call them from the normal Android app.

## Providers

### GET `/api/v1/admin/providers`
Returns provider config, embedded models, allowed plans, and `credential_count`. No pagination.

### POST `/api/v1/admin/providers`

```json
{
  "slug": "nvidia",
  "name": "Moataz NVIDIA",
  "description": "Managed NVIDIA",
  "provider_type": "openai_compatible",
  "base_url": "https://integrate.api.nvidia.com/v1",
  "enabled": true,
  "priority": 100,
  "failover_enabled": true,
  "credential_strategy": "priority",
  "plan_ids": ["22222222-2222-2222-2222-222222222222"]
}
```

Current schema accepts only `provider_type = openai_compatible`. Duplicate slug -> `409 CONFLICT`.

### PATCH `/api/v1/admin/providers`
Same fields plus required `id`.

### DELETE `/api/v1/admin/providers`

```json
{"id":"33333333-3333-3333-3333-333333333333"}
```

If usage history exists -> `409 CONFLICT`; disable instead.

## Credentials

### GET `/api/v1/admin/credentials?provider_id=<uuid>`
Metadata only; no plaintext or encrypted secret. `Cache-Control: no-store, private`.

```json
{
  "credentials": [
    {
      "id": "99999999-9999-9999-9999-999999999999",
      "provider_id": "33333333-3333-3333-3333-333333333333",
      "provider_name": "Moataz NVIDIA",
      "label": "Key 1",
      "source": "database",
      "key_mask": "nvapi-••••••••4F9A",
      "secret_ref": null,
      "enabled": true,
      "priority": 100,
      "health_status": "healthy",
      "last_checked_at": "2026-08-11T12:00:00.000Z",
      "last_error": null,
      "last_used_at": "2026-08-11T12:01:00.000Z",
      "failure_count": 0,
      "last_failure_at": null,
      "disabled_at": null,
      "created_at": "2026-08-11T11:00:00.000Z",
      "updated_at": "2026-08-11T12:00:00.000Z"
    }
  ]
}
```

### POST `/api/v1/admin/credentials`

Stored credential:

```json
{
  "provider_id": "33333333-3333-3333-3333-333333333333",
  "label": "Key 1",
  "source": "database",
  "api_key": "provider-key-entered-by-admin",
  "priority": 100,
  "enabled": true
}
```

Legacy environment source:

```json
{
  "provider_id": "33333333-3333-3333-3333-333333333333",
  "label": "Legacy Key",
  "source": "environment",
  "secret_ref": "NVIDIA_API_KEY_1",
  "priority": 100,
  "enabled": true
}
```

Response never includes `api_key` or `encrypted_api_key`.

### PATCH `/api/v1/admin/credentials/{id}`

```json
{"label":"Primary NVIDIA Key","priority":10,"enabled":true}
```

Rotation:

```json
{"api_key":"new-provider-api-key"}
```

### DELETE `/api/v1/admin/credentials/{id}`

```json
{"deleted":true,"warning":"Provider has no other active credentials"}
```

`warning` null if another active credential remains.

### POST `/api/v1/admin/credentials/{id}/test`
No body.

```json
{"ok":true,"status":200,"code":"CONNECTED","message":"Connected successfully","latency_ms":182}
```

Safe failures include `INVALID_CREDENTIAL`, `RATE_LIMITED`, `MODELS_UNSUPPORTED`, `TIMEOUT`, `UNREACHABLE`.

## Models

### GET `/api/v1/admin/models`
Returns models with provider name.

### POST `/api/v1/admin/models`

```json
{
  "provider_id": "33333333-3333-3333-3333-333333333333",
  "display_name": "Llama 3.3 70B",
  "remote_model_id": "meta/llama-3.3-70b-instruct",
  "enabled": true,
  "capabilities": ["text", "streaming"],
  "input_cost_per_million": null,
  "output_cost_per_million": null,
  "plan_ids": []
}
```

### PATCH `/api/v1/admin/models`
Same fields plus required model `id`.

No Admin model DELETE route currently exists.

## Plans

### GET `/api/v1/admin/plans`
Returns all plans.

### POST `/api/v1/admin/plans`

```json
{
  "slug": "pro",
  "name": "Moataz Pro",
  "description": "Higher limits",
  "enabled": true,
  "daily_token_limit": 500000,
  "monthly_token_limit": 10000000,
  "requests_per_minute": 60,
  "daily_request_limit": 5000,
  "monthly_request_limit": 100000,
  "storage_quota_bytes": 10737418240
}
```

Limit fields except storage may be null.

### PATCH `/api/v1/admin/plans`
Same body plus required `id`. No DELETE route.

## Users

### GET `/api/v1/admin/users`
Returns up to 250 profiles with nested plans and quotas. Fixed limit, no cursor/offset pagination.

### PATCH `/api/v1/admin/users`

```json
{
  "user_id": "11111111-1111-1111-1111-111111111111",
  "status": "active",
  "plan_id": "22222222-2222-2222-2222-222222222222",
  "quota": {
    "daily_token_limit": 100000,
    "monthly_token_limit": 1000000,
    "requests_per_minute": 20,
    "daily_request_limit": 500,
    "monthly_request_limit": 5000,
    "storage_quota_bytes": 536870912
  }
}
```

`status`, `plan_id`, `quota` individually optional; quota fields nullable.

## Usage

### GET `/api/v1/admin/usage?limit=100`
`limit` default 100, min 1, max 500. This is not full pagination; no cursor/offset.

```json
{
  "usage": [],
  "summary": {
    "requests": 0,
    "input_tokens": 0,
    "output_tokens": 0,
    "total_tokens": 0,
    "estimated_cost": 0
  }
}
```

## Settings

### GET `/api/v1/admin/settings`
Returns all `app_config` rows.

### PUT `/api/v1/admin/settings`

```json
{"key":"maintenance_mode","value":false,"is_public":true}
```

Upserts by key.

---

# 17. MISSING ANDROID ENDPOINTS

These are proposals only; they do **not** exist in current code.

## Effective quota

**Method:** `GET`  
**Suggested path:** `/api/v1/quota`

**Reason:** Android cannot currently read effective user-specific overrides or remaining quota.

Suggested response:

```json
{
  "limits": {
    "daily_tokens": 50000,
    "monthly_tokens": 500000,
    "requests_per_minute": 10,
    "daily_requests": 200,
    "monthly_requests": 3000,
    "storage_bytes": 104857600
  },
  "usage": {
    "daily_tokens": 1200,
    "monthly_tokens": 9000,
    "daily_requests": 4,
    "monthly_requests": 31,
    "storage_bytes": 2048
  },
  "remaining": {
    "daily_tokens": 48800,
    "monthly_tokens": 491000,
    "daily_requests": 196,
    "monthly_requests": 2969,
    "storage_bytes": 104855552
  }
}
```

## File download URL

**Method:** `POST`  
**Suggested path:** `/api/v1/files/download-url`

```json
{"attachment_id":"aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"}
```

Response:

```json
{"signed_url":"https://...temporary...","expires_in":300}
```

**Reason:** buckets are private; Android needs a server-authorized private download flow.

## Upload completion / attachment registration

**Method:** `POST`  
**Suggested path:** `/api/v1/files/complete`

```json
{
  "bucket": "images",
  "path": "user/conversation/file.jpg",
  "conversation_id": "55555555-5555-5555-5555-555555555555",
  "message_id": null,
  "mime_type": "image/jpeg",
  "size_bytes": 123456,
  "metadata": {"width":1024,"height":768}
}
```

Response:

```json
{
  "attachment": {
    "id": "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    "bucket": "images",
    "path": "user/conversation/file.jpg",
    "mime_type": "image/jpeg",
    "size_bytes": 123456
  }
}
```

**Reason:** current signed upload does not create attachment metadata, so storage usage and chat attachment references are incomplete.

## File delete

**Method:** `DELETE`  
**Suggested path:** `/api/v1/files/{attachmentId}`

```json
{"deleted":true}
```

**Reason:** no endpoint currently deletes Storage object + metadata atomically.

## File list

**Method:** `GET`  
**Suggested path:** `/api/v1/files?conversation_id=<uuid>&cursor=<cursor>`

**Reason:** no file/attachment discovery endpoint exists.

## Messages API

**Method:** `POST`  
**Suggested path:** `/api/v1/conversations/{id}/messages`

```json
{"role":"user","content":"Locally-created message to sync","local_only":false}
```

Response:

```json
{
  "id": "77777777-7777-7777-7777-777777777777",
  "conversation_id": "55555555-5555-5555-5555-555555555555",
  "role": "user",
  "content": "Locally-created message to sync",
  "local_only": false,
  "created_at": "2026-08-11T12:01:00.000Z"
}
```

A paginated `GET /api/v1/conversations/{id}/messages` is also missing.

**Reason:** no independent message sync route exists; streaming chat cannot persist a conversation.

## Streaming conversation persistence

Suggested change: add optional `conversation_id` to existing `/api/v1/chat/stream` or define a separate explicit contract.

## Tools / function calling

Current chat schemas do not support top-level `tools` / `tool_choice` or full `tool_calls` / `tool_call_id` message fields. If Android needs tools, the existing routes must be extended and documented first.

---

# 18. Final Android readiness matrix

| Method | Endpoint | Auth | Purpose | Android Needed | Status |
|---|---|---|---|---|---|
| POST | Supabase `/auth/v1/token?grant_type=password` | Publishable key | Email/password login | Yes | READY |
| POST | Supabase `/auth/v1/signup` | Publishable key | Account signup | Yes | READY |
| POST | Supabase token refresh / SDK `refreshSession` | Refresh token | Refresh session | Yes | READY |
| POST | Supabase logout / SDK `signOut` | Session | Logout | Yes | READY |
| GET | `/api/v1/config` | No | Remote app config | Yes | READY |
| GET | `/api/v1/me` | Bearer JWT | Account/profile + active plan + usage summary | Yes | READY |
| GET | `/api/v1/dashboard` | Bearer JWT | Aggregated account/plan/usage/providers | Yes | PARTIAL |
| GET | `/api/v1/providers` | Bearer JWT | Allowed managed provider list | Yes | PARTIAL |
| GET | `/api/v1/models?provider=...` | Bearer JWT | Allowed models + capabilities | Yes | PARTIAL |
| POST | `/api/v1/chat` | Bearer JWT | Managed non-streaming OpenAI-compatible chat | Yes | PARTIAL |
| POST | `/api/v1/chat/stream` | Bearer JWT | Managed SSE streaming chat | Yes | PARTIAL |
| GET | `/api/v1/usage` | Bearer JWT | Daily/monthly usage counters | Yes | PARTIAL |
| GET | `/api/v1/quota` | Bearer JWT | Effective/remaining quota | Yes | MISSING |
| POST | `/api/v1/files/upload-url` | Bearer JWT | Signed private upload target | Phase 2 | PARTIAL |
| POST | `/api/v1/files/download-url` | Bearer JWT | Signed private download | Phase 2 | MISSING |
| POST | `/api/v1/files/complete` | Bearer JWT | Register uploaded attachment | Phase 2 | MISSING |
| DELETE | `/api/v1/files/{attachmentId}` | Bearer JWT | Delete file + metadata | Phase 2 | MISSING |
| GET | `/api/v1/files` | Bearer JWT | List files/attachments | Phase 2 | MISSING |
| GET | `/api/v1/conversations` | Bearer JWT | List cloud conversations | Phase 2 | READY |
| POST | `/api/v1/conversations` | Bearer JWT | Create cloud conversation | Phase 2 | READY |
| GET | `/api/v1/conversations/{id}` | Bearer JWT | Conversation + all messages | Phase 2 | READY |
| DELETE | `/api/v1/conversations/{id}` | Bearer JWT | Delete cloud conversation | Phase 2 | READY |
| GET | `/api/v1/conversations/{id}/messages` | Bearer JWT | Paginated messages | Phase 2 | MISSING |
| POST | `/api/v1/conversations/{id}/messages` | Bearer JWT | Explicit message cloud sync | Phase 2 | MISSING |

---

# 19. Integration recommendation based on current API

Android can begin with:

```text
Supabase Auth
    ↓
MoatazCloudClient
    ↓
GET /config
GET /me
GET /dashboard
GET /providers
GET /models
    ↓
Managed Provider Adapter
    ↓
POST /chat
POST /chat/stream
    ↓
ChatService
    ↓
Moataz AI UI
```

But Android models must follow the actual current shapes:

1. `/providers` and `/models` are separate.
2. `/providers` does not return models, capabilities, quota, or explicit enabled/plan-access fields.
3. `/dashboard.quota` is currently usage data, not an effective quota-limit DTO.
4. `/chat` returns raw OpenAI-compatible provider JSON.
5. `/chat/stream` forwards provider SSE rather than a custom Moataz event schema.
6. Tool definitions/tool calls are not a supported request contract yet.
7. Signed upload exists, but the full file lifecycle does not.
8. Conversation CRUD exists, but explicit message CRUD and streaming persistence do not.

For the first Android managed-chat integration: Auth, Config, and Me are READY; Dashboard/Providers/Models/Chat/Streaming/Usage are usable with the PARTIAL limitations documented above; Storage and full Cloud Sync should be Phase 2 until the missing endpoints are implemented.
