import { requireAdminRequest } from '@/lib/admin/api-guard';
import { ApiError,errorResponse } from '@/lib/api/errors';
import { resolveCredentialSecret } from '@/lib/ai/credential-crypto';
import { testOpenAICompatible } from '@/lib/ai/provider';
import { z } from 'zod';

const noStore={'cache-control':'no-store, private'};
function trust(){const value=process.env.MOATAZ_TRUST_TOKEN;if(!value)throw new ApiError('CONFIGURATION_ERROR','Backend trust token is not configured',500);return value}

export async function POST(req:Request,{params}:{params:Promise<{id:string}>}){try{
  const {id}=await params;if(!z.string().uuid().safeParse(id).success)throw new ApiError('VALIDATION_ERROR','Invalid credential id',422);
  const {client}=await requireAdminRequest(req);const secret=trust();const {data,error}=await client.rpc('admin_get_provider_credential_secret',{p_id:id,p_backend_secret:secret});if(error)throw error;const row=data?.[0];if(!row)throw new ApiError('NOT_FOUND','Credential not found',404);
  const apiKey=resolveCredentialSecret(row,row.provider_id);const result=await testOpenAICompatible(row.base_url,apiKey);
  await client.rpc('record_provider_credential_attempt',{p_credential_id:id,p_success:result.ok,p_status_code:result.status,p_error_code:result.code,p_latency_ms:result.latency_ms,p_backend_secret:secret});
  return Response.json(result,{status:result.ok?200:result.status===401||result.status===403?401:result.status===429?429:200,headers:noStore});
}catch(e){return errorResponse(e)}}
