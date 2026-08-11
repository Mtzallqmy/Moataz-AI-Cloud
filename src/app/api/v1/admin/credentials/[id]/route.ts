import type { SupabaseClient } from '@supabase/supabase-js';
import { requireAdminRequest } from '@/lib/admin/api-guard';
import { audit } from '@/lib/admin/audit';
import { ApiError,errorResponse } from '@/lib/api/errors';
import { encryptCredential,maskCredential } from '@/lib/ai/credential-crypto';
import { z } from 'zod';

const schema=z.object({label:z.string().trim().min(1).max(120).optional(),priority:z.number().int().min(0).max(100000).optional(),enabled:z.boolean().optional(),api_key:z.string().trim().min(1).max(20000).optional(),secret_ref:z.string().regex(/^[A-Z][A-Z0-9_]*$/).optional()});
const noStore={'cache-control':'no-store, private'};
function trust(){const value=process.env.MOATAZ_TRUST_TOKEN;if(!value)throw new ApiError('CONFIGURATION_ERROR','Backend trust token is not configured',500);return value}
async function metadata(client:SupabaseClient,id:string){const {data,error}=await client.rpc('admin_list_provider_credentials_metadata',{p_provider_id:null});if(error)throw error;const row=(data??[]).find((x:{id:string})=>x.id===id);if(!row)throw new ApiError('NOT_FOUND','Credential not found',404);return row}

export async function PATCH(req:Request,{params}:{params:Promise<{id:string}>}){try{
  const {id}=await params;if(!z.string().uuid().safeParse(id).success)throw new ApiError('VALIDATION_ERROR','Invalid credential id',422);
  const {user,client}=await requireAdminRequest(req);const before=await metadata(client,id);const body=schema.parse(await req.json());
  let encrypted:string|null=null,mask:string|null=null;
  if(body.api_key){if(before.source!=='database')throw new ApiError('VALIDATION_ERROR','Environment credentials cannot be replaced with a stored key',422);encrypted=encryptCredential(body.api_key,before.provider_id);mask=maskCredential(body.api_key)}
  if(body.secret_ref&&before.source!=='environment')throw new ApiError('VALIDATION_ERROR','Stored credentials do not use environment references',422);
  const {error}=await client.rpc('admin_update_provider_credential',{p_id:id,p_label:body.label??before.label,p_enabled:body.enabled??before.enabled,p_priority:body.priority??before.priority,p_secret_ref:body.secret_ref??null,p_encrypted_api_key:encrypted,p_key_mask:mask,p_backend_secret:trust()});if(error)throw error;
  const after=await metadata(client,id);await audit(client,req,user.id,body.api_key?'credential.rotate':'credential.update','provider_credential',id,before,after);return Response.json(after,{headers:noStore});
}catch(e){return errorResponse(e)}}

export async function DELETE(req:Request,{params}:{params:Promise<{id:string}>}){try{
  const {id}=await params;if(!z.string().uuid().safeParse(id).success)throw new ApiError('VALIDATION_ERROR','Invalid credential id',422);
  const {user,client}=await requireAdminRequest(req);const before=await metadata(client,id);const {data:all}=await client.rpc('admin_list_provider_credentials_metadata',{p_provider_id:before.provider_id});const active=(all??[]).filter((x:{enabled:boolean,id:string})=>x.enabled&&x.id!==id).length;
  const {error}=await client.rpc('admin_delete_provider_credential',{p_id:id,p_backend_secret:trust()});if(error)throw error;await audit(client,req,user.id,'credential.delete','provider_credential',id,before,null);
  return Response.json({deleted:true,warning:active===0?'Provider has no other active credentials':null},{headers:noStore});
}catch(e){return errorResponse(e)}}
