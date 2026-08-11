import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ApiError } from '@/lib/api/errors';

const VERSION='v1';
const AAD_PREFIX='moataz-ai-cloud:provider-credential:';

function encryptionKey(){
  const raw=process.env.CREDENTIAL_ENCRYPTION_KEY;
  if(!raw) throw new ApiError('CONFIGURATION_ERROR','Credential encryption is not configured',500);
  let key:Buffer;
  try{key=Buffer.from(raw,'base64')}catch{throw new ApiError('CONFIGURATION_ERROR','Credential encryption key is invalid',500)}
  if(key.length!==32) throw new ApiError('CONFIGURATION_ERROR','Credential encryption key must decode to 32 bytes',500);
  return key;
}

export function maskCredential(secret:string){
  const value=secret.trim();
  const last=value.slice(-4);
  const dash=value.indexOf('-');
  const prefix=dash>0&&dash<=8?value.slice(0,dash+1):'';
  return `${prefix}••••••••${last}`;
}

export function encryptCredential(secret:string,providerId:string){
  const plaintext=secret.trim();
  if(!plaintext) throw new ApiError('VALIDATION_ERROR','API key is required',422);
  const iv=randomBytes(12);
  const cipher=createCipheriv('aes-256-gcm',encryptionKey(),iv);
  cipher.setAAD(Buffer.from(`${AAD_PREFIX}${providerId}`,'utf8'));
  const ciphertext=Buffer.concat([cipher.update(plaintext,'utf8'),cipher.final()]);
  const tag=cipher.getAuthTag();
  return `${VERSION}.${iv.toString('base64url')}.${tag.toString('base64url')}.${ciphertext.toString('base64url')}`;
}

export function decryptCredential(payload:string,providerId:string){
  const [version,iv64,tag64,data64]=payload.split('.');
  if(version!==VERSION||!iv64||!tag64||!data64) throw new ApiError('CONFIGURATION_ERROR','Stored credential format is invalid',500);
  try{
    const decipher=createDecipheriv('aes-256-gcm',encryptionKey(),Buffer.from(iv64,'base64url'));
    decipher.setAAD(Buffer.from(`${AAD_PREFIX}${providerId}`,'utf8'));
    decipher.setAuthTag(Buffer.from(tag64,'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data64,'base64url')),decipher.final()]).toString('utf8');
  }catch{
    throw new ApiError('CONFIGURATION_ERROR','Stored credential could not be decrypted',500);
  }
}

export type RuntimeCredential={id:string;provider_id?:string;source:'database'|'environment';secret_ref:string|null;encrypted_api_key:string|null};
export function resolveCredentialSecret(credential:RuntimeCredential,providerId:string){
  if(credential.source==='database'){
    if(!credential.encrypted_api_key) throw new ApiError('CONFIGURATION_ERROR','Stored credential is incomplete',500);
    return decryptCredential(credential.encrypted_api_key,providerId);
  }
  if(!credential.secret_ref) throw new ApiError('CONFIGURATION_ERROR','Environment credential reference is missing',500);
  const value=process.env[credential.secret_ref];
  if(!value) throw new ApiError('CONFIGURATION_ERROR',`Credential environment reference is not configured`,503);
  return value;
}
