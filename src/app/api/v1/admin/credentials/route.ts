import { requireAdminRequest } from '@/lib/admin/api-guard';
import { audit } from '@/lib/admin/audit';
import { ApiError,errorResponse } from '@/lib/api/errors';
import { encryptCredential,maskCredential } from '@/lib/ai/credential-crypto';
import { z } from 'zod';

const base=z.object({provider_id:z.string().uuid(),label:z.string().trim().min(1).max(120),priority:z.number().int().min(0).max(100000).default(100),enabled:z.boolean().default(true)});
const schema=z.discriminatedUnion('source',[
  base.extend({source:z.literal('database').default('database'),api_key:z.string().trim().min(1).max(20000)}),
  base.extend({source:z.literal('environment'),secret_ref:z.string().regex(/^[A-Z][A-Z0-9_]*$/)})
]);
const noStore={'cache-control':'no-store, private'};
function trust(){const value=process.env.MOATAZ_TRUST_TOKEN;if(!value)throw new ApiError('CONFIGURATION_ERROR','Backend trust token is not configured',500);return value}

export async function GET(req:Request){try{const {client}=await requireAdminRequest(req);const providerId=new URL(req.url).searchParams.get('provider_id');if(providerId&& !z.string().uuid().safeParse(providerId).success)throw new ApiError('VALIDATION_ERROR','Invalid provider id',422);const {data,error}=await client.rpc('admin_list_provider_credentials_metadata',{p_provider_id:providerId||null});if(error)throw error;return Response.json({credentials:data??[]},{headers:noStore})}catch(e){return errorResponse(e)}}

export async function POST(req:Request){try{
  const {user,client}=await requireAdminRequest(req);const body=schema.parse(await req.json());
  let encrypted:string|null=null,mask:string|null=null,secretRef:string|null=null;
  if(body.source==='database'){encrypted=encryptCredential(body.api_key,body.provider_id);mask=maskCredential(body.api_key)}else secretRef=body.secret_ref;
  const {data:id,error}=await client.rpc('admin_create_provider_credential',{p_provider_id:body.provider_id,p_label:body.label,p_source:body.source,p_secret_ref:secretRef,p_encrypted_api_key:encrypted,p_key_mask:mask,p_enabled:body.enabled,p_priority:body.priority,p_backend_secret:trust()});if(error)throw error;
  const {data:list,error:listError}=await client.rpc('admin_list_provider_credentials_metadata',{p_provider_id:body.provider_id});if(listError)throw listError;const created=(list??[]).find((x:{id:string})=>x.id===id);
  await audit(client,req,user.id,'credential.create','provider_credential',String(id),null,{id,provider_id:body.provider_id,label:body.label,source:body.source,key_mask:mask,enabled:body.enabled,priority:body.priority});
  return Response.json(created??{id,provider_id:body.provider_id,label:body.label,source:body.source,key_mask:mask,enabled:body.enabled,priority:body.priority},{status:201,headers:noStore});
}catch(e){return errorResponse(e)}}
