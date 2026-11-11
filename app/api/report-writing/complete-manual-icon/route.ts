// Retired contract: an old icon-only confirmation cannot attest to every step.
import {NextResponse} from 'next/server';
import {requireActiveApiUser,ApiAuthorizationError} from '@/lib/auth';
export const runtime='nodejs';
export const dynamic='force-dynamic';
async function retired(){
 try{await requireActiveApiUser(['typist','practice_manager','admin','super_admin']);}
 catch(error){return NextResponse.json({success:false,error:'Authentication and authorisation are required.'},{status:error instanceof ApiAuthorizationError?error.status:503});}
 return NextResponse.json({success:false,error:'Refresh this page to use manual workflow completion.'},{status:409,headers:{'Cache-Control':'private, no-store'}});
}
export const GET=retired;
export const POST=retired;
