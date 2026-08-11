import { NextResponse } from 'next/server';
export type ErrorCode='AUTH_REQUIRED'|'ACCOUNT_DISABLED'|'PROVIDER_DISABLED'|'MODEL_DISABLED'|'PLAN_REQUIRED'|'QUOTA_EXCEEDED'|'RATE_LIMITED'|'STORAGE_LIMIT'|'PROVIDER_ERROR'|'INTERNAL_ERROR'|'NOT_FOUND'|'FORBIDDEN'|'VALIDATION_ERROR';
export class ApiError extends Error{constructor(public code:ErrorCode,message:string,public status=400,public details:Record<string,unknown>={}){super(message)}}
export function errorResponse(error:unknown){
  if(error instanceof ApiError) return NextResponse.json({error:{code:error.code,message:error.message,details:error.details}},{status:error.status});
  console.error(error);return NextResponse.json({error:{code:'INTERNAL_ERROR',message:'Internal server error',details:{}}},{status:500});
}
