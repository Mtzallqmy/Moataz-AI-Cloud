import { NextResponse } from 'next/server';
export type ErrorCode='AUTH_REQUIRED'|'ACCOUNT_DISABLED'|'PROVIDER_DISABLED'|'MODEL_DISABLED'|'PLAN_REQUIRED'|'QUOTA_EXCEEDED'|'RATE_LIMITED'|'STORAGE_LIMIT'|'PROVIDER_ERROR'|'INVALID_CREDENTIAL'|'INVALID_MODEL'|'PROVIDER_UNAVAILABLE'|'PROVIDER_TIMEOUT'|'CONFIGURATION_ERROR'|'CONFLICT'|'INTERNAL_ERROR'|'NOT_FOUND'|'FORBIDDEN'|'VALIDATION_ERROR';
export class ApiError extends Error{constructor(public code:ErrorCode,message:string,public status=400,public details:Record<string,unknown>={}){super(message)}}
export function errorResponse(error:unknown){
  if(error instanceof ApiError) return NextResponse.json({error:{code:error.code,message:error.message,details:error.details}},{status:error.status,headers:{'cache-control':'no-store'}});
  if(error&&typeof error==='object'&&(error as {name?:string}).name==='ZodError'){
    const issues=(error as {issues?:Array<{path?:PropertyKey[];message?:string}>}).issues?.map(x=>({path:(x.path??[]).map(String).join('.'),message:x.message??'Invalid value'}))??[];
    return NextResponse.json({error:{code:'VALIDATION_ERROR',message:'Request validation failed',details:{issues}}},{status:422,headers:{'cache-control':'no-store'}});
  }
  console.error(error instanceof Error?{name:error.name,message:error.message}:{message:'Unknown server error'});
  return NextResponse.json({error:{code:'INTERNAL_ERROR',message:'Internal server error',details:{}}},{status:500,headers:{'cache-control':'no-store'}});
}
