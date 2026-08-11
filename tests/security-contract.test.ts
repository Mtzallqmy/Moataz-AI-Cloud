import { describe,it,expect } from 'vitest';import fs from 'node:fs';import path from 'node:path';
const read=(p:string)=>fs.readFileSync(path.join(process.cwd(),p),'utf8');
const m1=read('supabase/migrations/20260811190000_initial_schema.sql');const m2=read('supabase/migrations/20260811194500_backend_trust_and_admin_rls.sql');const m3=read('supabase/migrations/20260811200000_encrypted_provider_credentials.sql');
const chat=read('src/app/api/v1/chat/route.ts');const gateway=read('src/lib/ai/gateway.ts');const crypto=read('src/lib/ai/credential-crypto.ts');const credentials=read('src/app/api/v1/admin/credentials/route.ts');const auth=read('src/lib/auth/api-context.ts');const admin=read('src/lib/admin/guard.ts');const upload=read('src/app/api/v1/files/upload-url/route.ts');
describe('security contracts',()=>{
 it('auth validates bearer with Supabase Auth',()=>{expect(auth).toContain("startsWith('Bearer ')");expect(auth).toContain('auth.getUser(token)')});
 it('admin authorization never uses user_metadata',()=>{expect(admin).toContain("from('admin_users')");expect(admin).not.toContain('user_metadata')});
 it('enables RLS and owner policies',()=>{expect(m1).toContain('enable row level security');expect(m1).toContain("auth.uid())=user_id");expect(m1).toContain('profiles_self_select')});
 it('encrypts database credentials with authenticated encryption',()=>{expect(crypto).toContain("import 'server-only'");expect(crypto).toContain("createCipheriv('aes-256-gcm'");expect(crypto).toContain('randomBytes(12)');expect(crypto).toContain('getAuthTag()');expect(crypto).toContain('setAuthTag(');expect(crypto).toContain('CREDENTIAL_ENCRYPTION_KEY')});
 it('does not expose encrypted credential table directly',()=>{expect(m3).toContain('revoke all on table public.provider_credentials from anon,authenticated');expect(m3).toContain('admin_list_provider_credentials_metadata');expect(credentials).not.toContain("select('*')")});
 it('keeps environment credentials backward compatible',()=>{expect(m3).toContain("source in('environment','database')");expect(gateway).toContain('resolveCredentialSecret')});
 it('quota reservation is locked and backend-secret protected',()=>{expect(m2).toContain('pg_advisory_xact_lock');expect(m2).toContain('backend_secret_valid');expect(m2).toContain('RATE_LIMITED');expect(m2).toContain('QUOTA_EXCEEDED')});
 it('provider and model disabled checks are enforced in database',()=>{expect(m2).toContain("raise exception 'PROVIDER_DISABLED'");expect(m2).toContain("raise exception 'MODEL_DISABLED'")});
 it('usage is finalized by trusted RPC after managed chat',()=>{expect(chat).toContain("rpc('finalize_managed_usage'");expect(m2).toContain('where id=p_usage_id and user_id=(select auth.uid())')});
 it('credential failover is bounded',()=>{expect(gateway).toContain('Math.min(targets.length,3)');expect(gateway).toContain('retryCredential')});
 it('file paths are owner-prefixed and quota checked',()=>{expect(upload).toContain('`${user.id}/');expect(upload).toContain("ApiError('STORAGE_LIMIT'");expect(m1).toContain('(storage.foldername(name))[1]=(select auth.uid())::text')});
 it('managed chat reserves before gateway execution',()=>{expect(chat.indexOf("rpc('reserve_managed_request'")).toBeLessThan(chat.indexOf('executeManagedChat'))});
});
