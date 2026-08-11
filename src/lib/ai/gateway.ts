import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from '@/lib/api/errors';
import { resolveCredentialSecret } from '@/lib/ai/credential-crypto';
import { callOpenAICompatible,ProviderRequestError,providerErrorToApi,type ChatInput } from '@/lib/ai/provider';

type Target={id:string;source:'database'|'environment';secret_ref:string|null;encrypted_api_key:string|null;priority:number;base_url:string;provider_type:string;provider_failover_enabled:boolean;credential_strategy:string;remote_model_id:string;input_cost_per_million:number|null;output_cost_per_million:number|null};

async function record(client:SupabaseClient,target:Target,success:boolean,status:number,code:string,latency:number,trust:string){
  await client.rpc('record_provider_credential_attempt',{p_credential_id:target.id,p_success:success,p_status_code:status,p_error_code:code,p_latency_ms:latency,p_backend_secret:trust});
}

export async function executeManagedChat(client:SupabaseClient,providerId:string,modelId:string,input:ChatInput,trust:string){
  const {data,error}=await client.rpc('api_runtime_credentials',{p_provider_id:providerId,p_model_id:modelId,p_backend_secret:trust});
  if(error)throw error;const targets=(data??[]) as Target[];
  if(!targets.length)throw new ApiError('PROVIDER_UNAVAILABLE','No active provider credential is configured',503);
  const failover=targets[0]?.provider_failover_enabled!==false;const attempts=failover?Math.min(targets.length,3):1;let last:unknown;
  for(let i=0;i<attempts;i++){
    const target=targets[i];const started=Date.now();
    try{
      const key=resolveCredentialSecret(target,providerId);
      const response=await callOpenAICompatible(target.base_url,key,target.remote_model_id,{...input,model:target.remote_model_id});
      await record(client,target,true,response.status,'OK',Date.now()-started,trust);
      return {response,target};
    }catch(error){
      last=error;const providerError=error instanceof ProviderRequestError?error:null;const configurationError=error instanceof ApiError&&error.code==='CONFIGURATION_ERROR';
      await record(client,target,false,providerError?.status??500,providerError?.kind??(configurationError?'CONFIGURATION_ERROR':'PROVIDER_ERROR'),Date.now()-started,trust).catch(()=>{});
      const retryable=providerError?.retryCredential||configurationError;
      if(!retryable||i===attempts-1)break;
    }
  }
  throw providerErrorToApi(last);
}
