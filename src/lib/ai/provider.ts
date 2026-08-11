import 'server-only';
import { ApiError } from '@/lib/api/errors';

export type ChatInput={model:string;messages:Array<{role:string;content:unknown}>;stream?:boolean;temperature?:number;max_tokens?:number};

export class ProviderRequestError extends Error{
  constructor(public status:number,public kind:'invalid_credential'|'invalid_model'|'rate_limited'|'timeout'|'unavailable'|'bad_request',message:string){super(message)}
  get retryCredential(){return this.kind==='invalid_credential'||this.kind==='rate_limited'||this.kind==='timeout'||this.kind==='unavailable'}
}

export function normalizeProviderBaseUrl(input:string){
  const url=new URL(input.trim());
  url.pathname=url.pathname.replace(/\/+$/,'').replace(/\/(chat\/completions|models)$/,'');
  return url.toString().replace(/\/$/,'');
}

function classify(status:number){
  if(status===401||status===403)return 'invalid_credential' as const;
  if(status===404)return 'invalid_model' as const;
  if(status===429)return 'rate_limited' as const;
  if(status===408||status===504)return 'timeout' as const;
  if(status>=500)return 'unavailable' as const;
  return 'bad_request' as const;
}

export async function callOpenAICompatible(baseUrl:string,apiKey:string,remoteModelId:string,input:ChatInput,timeoutMs=45000){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const res=await fetch(`${normalizeProviderBaseUrl(baseUrl)}/chat/completions`,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${apiKey}`},body:JSON.stringify({...input,model:remoteModelId}),signal:controller.signal,cache:'no-store'});
    if(!res.ok)throw new ProviderRequestError(res.status,classify(res.status),`Provider request failed with status ${res.status}`);
    return res;
  }catch(error){
    if(error instanceof ProviderRequestError)throw error;
    if(error instanceof DOMException&&error.name==='AbortError')throw new ProviderRequestError(408,'timeout','Provider request timed out');
    throw new ProviderRequestError(503,'unavailable','Provider is unreachable');
  }finally{clearTimeout(timer)}
}

export async function testOpenAICompatible(baseUrl:string,apiKey:string,timeoutMs=8000){
  const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),timeoutMs);const started=Date.now();
  try{
    const res=await fetch(`${normalizeProviderBaseUrl(baseUrl)}/models`,{headers:{authorization:`Bearer ${apiKey}`},signal:controller.signal,cache:'no-store'});
    if(res.ok)return {ok:true,status:res.status,code:'CONNECTED',message:'Connected successfully',latency_ms:Date.now()-started};
    const kind=classify(res.status);
    if(res.status===404)return {ok:false,status:404,code:'MODELS_UNSUPPORTED',message:'Provider reachable but /models is not supported',latency_ms:Date.now()-started};
    return {ok:false,status:res.status,code:kind==='invalid_credential'?'INVALID_CREDENTIAL':kind==='rate_limited'?'RATE_LIMITED':'PROVIDER_ERROR',message:kind==='invalid_credential'?'Authentication failed':kind==='rate_limited'?'Rate limited':'Provider returned an error',latency_ms:Date.now()-started};
  }catch(error){
    if(error instanceof DOMException&&error.name==='AbortError')return {ok:false,status:408,code:'TIMEOUT',message:'Provider timed out',latency_ms:Date.now()-started};
    return {ok:false,status:503,code:'UNREACHABLE',message:'Provider unreachable',latency_ms:Date.now()-started};
  }finally{clearTimeout(timer)}
}

export function providerErrorToApi(error:unknown){
  if(!(error instanceof ProviderRequestError))return error;
  if(error.kind==='invalid_credential')return new ApiError('INVALID_CREDENTIAL','Provider credential was rejected',502,{provider_status:error.status});
  if(error.kind==='invalid_model')return new ApiError('INVALID_MODEL','Provider model was not found',422,{provider_status:error.status});
  if(error.kind==='rate_limited')return new ApiError('RATE_LIMITED','Provider rate limit reached',429,{provider_status:error.status});
  if(error.kind==='timeout')return new ApiError('PROVIDER_TIMEOUT','Provider request timed out',504,{provider_status:error.status});
  if(error.kind==='unavailable')return new ApiError('PROVIDER_UNAVAILABLE','Provider is unavailable',503,{provider_status:error.status});
  return new ApiError('PROVIDER_ERROR','Provider rejected the request',502,{provider_status:error.status});
}
