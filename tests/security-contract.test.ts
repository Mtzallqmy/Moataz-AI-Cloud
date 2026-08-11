import { describe,it,expect } from 'vitest';import fs from 'node:fs';import path from 'node:path';
const m1=fs.readFileSync(path.join(process.cwd(),'supabase/migrations/20260811190000_initial_schema.sql'),'utf8');
const m2=fs.readFileSync(path.join(process.cwd(),'supabase/migrations/20260811194500_backend_trust_and_admin_rls.sql'),'utf8');
const chat=fs.readFileSync(path.join(process.cwd(),'src/app/api/v1/chat/route.ts'),'utf8');
const auth=fs.readFileSync(path.join(process.cwd(),'src/lib/auth/api-context.ts'),'utf8');
const admin=fs.readFileSync(path.join(process.cwd(),'src/lib/admin/guard.ts'),'utf8');
const upload=fs.readFileSync(path.join(process.cwd(),'src/app/api/v1/files/upload-url/route.ts'),'utf8');
describe('security contracts',()=>{
 it('auth validates bearer with Supabase Auth',()=>{expect(auth).toContain("startsWith('Bearer ')");expect(auth).toContain('auth.getUser(token)')});
 it('admin authorization never uses user_metadata',()=>{expect(admin).toContain("from('admin_users')");expect(admin).not.toContain('user_metadata')});
 it('enables RLS and owner policies',()=>{expect(m1).toContain('enable row level security');expect(m1).toContain("auth.uid())=user_id");expect(m1).toContain('profiles_self_select')});
 it('keeps credential values out of postgres',()=>{expect(m1).toContain('secret_ref text not null');expect(m1).not.toMatch(/api_key\s+text/i)});
 it('quota reservation is locked and backend-secret protected',()=>{expect(m2).toContain('pg_advisory_xact_lock');expect(m2).toContain('backend_secret_valid');expect(m2).toContain('RATE_LIMITED');expect(m2).toContain('QUOTA_EXCEEDED')});
 it('provider and model disabled checks are enforced in database',()=>{expect(m2).toContain("raise exception 'PROVIDER_DISABLED'");expect(m2).toContain("raise exception 'MODEL_DISABLED'")});
 it('usage is finalized by trusted RPC after managed chat',()=>{expect(chat).toContain("rpc('finalize_managed_usage'");expect(m2).toContain('where id=p_usage_id and user_id=(select auth.uid())')});
 it('file paths are owner-prefixed and quota checked',()=>{expect(upload).toContain('`${user.id}/');expect(upload).toContain("ApiError('STORAGE_LIMIT'");expect(m1).toContain('(storage.foldername(name))[1]=(select auth.uid())::text')});
 it('managed chat reserves before provider call',()=>{expect(chat.indexOf("rpc('reserve_managed_request'")).toBeLessThan(chat.indexOf('await callOpenAICompatible'))});
});
