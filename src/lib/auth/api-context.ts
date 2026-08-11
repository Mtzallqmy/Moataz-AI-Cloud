import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js';
import { ApiError } from '@/lib/api/errors';
export type ApiContext={user:User;client:SupabaseClient;token:string};
export async function requireApiContext(request:Request):Promise<ApiContext>{
  const header=request.headers.get('authorization');
  if(!header?.startsWith('Bearer ')) throw new ApiError('AUTH_REQUIRED','Bearer token required',401);
  const token=header.slice(7).trim();
  const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await client.auth.getUser(token);
  if(error||!data.user) throw new ApiError('AUTH_REQUIRED','Invalid or expired token',401);
  const {data:profile}=await client.from('profiles').select('status').eq('id',data.user.id).single();
  if(profile?.status==='blocked') throw new ApiError('ACCOUNT_DISABLED','Account is disabled',403);
  return {user:data.user,client,token};
}
