import { requireApiContext } from '@/lib/auth/api-context';import { errorResponse } from '@/lib/api/errors';import { usageSummary } from '@/lib/api/data';
export async function GET(req:Request){try{const {user,client}=await requireApiContext(req);return Response.json(await usageSummary(client,user.id))}catch(e){return errorResponse(e)}}
