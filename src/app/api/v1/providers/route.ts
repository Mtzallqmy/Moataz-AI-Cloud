import { requireApiContext } from '@/lib/auth/api-context';import { errorResponse } from '@/lib/api/errors';
export async function GET(req:Request){try{const {client}=await requireApiContext(req);const {data,error}=await client.rpc('api_allowed_providers');if(error)throw error;return Response.json({providers:data??[]})}catch(e){return errorResponse(e)}}
