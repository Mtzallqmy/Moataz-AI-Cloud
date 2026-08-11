import type { User } from '@supabase/supabase-js';import { requireApiContext } from './api-context';
export async function requireApiUser(request:Request):Promise<User>{return (await requireApiContext(request)).user}
