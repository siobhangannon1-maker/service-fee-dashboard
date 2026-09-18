import { NextResponse } from "next/server";
import { ApiAuthorizationError, requireActiveApiUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { continuationIntentId, validWorkflowAuthorization } from "@/lib/report-writing/workflow-continuation-token";
import { withWorkflowExecution } from "@/lib/report-writing/workflow-execution-context";
import { POST as sendViaMediref } from "../send-via-mediref/route";

export const runtime = "nodejs";
export const maxDuration = 180;

const ACTIVE = ["waiting", "pending", "processing", "running"];

async function access() {
  try {
    const { user } = await requireActiveApiUser(["admin", "super_admin", "practice_manager", "typist"]);
    return { actorId: user.id, denied: null };
  } catch (error) {
    const status = error instanceof ApiAuthorizationError ? error.status : 403;
    const reason = status === 401 ? "unauthenticated" :
      error instanceof ApiAuthorizationError && error.message === "An active account is required." ? "inactive_user" : "unauthorized";
    return { actorId: null, denied: NextResponse.json({ success:false, eligible:false, reason }, { status }) };
  }
}

async function state(draftId:string) {
  const {data:draft,error:de}=await supabaseAdmin.from("report_drafts")
    .select("id,status,deleted_at,provider_id,uploaded_to_praktika,workflow_praktika_upload_status,workflow_icon_update_status,workflow_mediref_status,emailed_to_referrer_at")
    .eq("id",draftId).maybeSingle();
  if(de) throw new Error("draft");
  if(!draft) return {draft:null,providerActive:false,parent:null,medirefJobs:[],replacement:null};

  const {data:provider,error:pe}=await supabaseAdmin.from("providers").select("id").eq("id",draft.provider_id).eq("is_active",true).maybeSingle();
  if(pe) throw new Error("provider");

  const {data:parent,error:pae}=await supabaseAdmin.from("praktika_helper_jobs").select("id,status,app_user_id,request,response")
    .eq("id",continuationIntentId(draftId)).eq("job_type","complete_report_workflow").maybeSingle();
  if(pae) throw new Error("parent");

  const {data:medirefJobs,error:me}=await supabaseAdmin.from("mediref_helper_jobs").select("id,status")
    .eq("job_type","send_mediref_letter").eq("payload->>draftId",draftId);
  if(me) throw new Error("mediref");

  const retryUploadId=typeof parent?.response?.retryUploadId==="string"?parent.response.retryUploadId:null;
  let replacement:any=null;
  if(retryUploadId){
    const {data,error}=await supabaseAdmin.from("praktika_helper_jobs").select("id,status,request")
      .eq("id",retryUploadId).eq("job_type","upload_report_to_praktika").maybeSingle();
    if(error) throw new Error("replacement");
    replacement=data;
  }
  return {draft,providerActive:Boolean(provider),parent,medirefJobs:medirefJobs||[],replacement};
}

function eligible(s:Awaited<ReturnType<typeof state>>,draftId:string){
  const {draft,providerActive,parent,medirefJobs,replacement}=s;
  if(!draft||draft.deleted_at||!["approved","uploaded_to_praktika"].includes(draft.status)) return {eligible:false,reason:"invalid_state"};
  if(!providerActive) return {eligible:false,reason:"inactive_provider"};
  if(!parent) return {eligible:false,reason:"missing_workflow"};
  if(!parent.app_user_id||!validWorkflowAuthorization(draftId,parent.app_user_id,parent.request?.options,process.env.SUPABASE_SERVICE_ROLE_KEY||""))
    return {eligible:false,reason:"invalid_authorization"};

  const retryUploadId=typeof parent.response?.retryUploadId==="string"?parent.response.retryUploadId:null;
  if(!retryUploadId||!replacement) return {eligible:false,reason:"no_praktika_recovery"};
  if(replacement.id!==retryUploadId||replacement.status!=="completed"||
     replacement.request?.continuationId!==parent.id||replacement.request?.reportDraftId!==draftId||
     replacement.request?.manualRetry?.verifiedAbsent!==true)
    return {eligible:false,reason:"praktika_recovery_incomplete"};
  if(draft.uploaded_to_praktika!==true||draft.workflow_praktika_upload_status!=="completed")
    return {eligible:false,reason:"praktika_recovery_incomplete"};
  if(!["completed","skipped"].includes(String(draft.workflow_icon_update_status||"")))
    return {eligible:false,reason:"icon_incomplete"};
  if(draft.workflow_mediref_status==="completed"||draft.emailed_to_referrer_at)
    return {eligible:false,reason:"mediref_completed"};
  if(medirefJobs.length) return {eligible:false,reason:medirefJobs.some((j:any)=>ACTIVE.includes(j.status))?"mediref_active":"mediref_history_exists"};
  if(!["waiting","processing"].includes(parent.status)||parent.response?.stage!=="mediref")
    return {eligible:false,reason:"workflow_not_waiting_for_mediref"};
  if(!parent.request?.options) return {eligible:false,reason:"missing_options"};
  return {eligible:true,reason:"eligible"};
}

export async function GET(req:Request){
  const {denied}=await access(); if(denied) return denied;
  try{
    const draftId=new URL(req.url).searchParams.get("draftId")||"";
    const s=await state(draftId);
    return NextResponse.json({success:true,...eligible(s,draftId)});
  }catch{
    return NextResponse.json({success:false,eligible:false,reason:"lookup_unavailable"},{status:503});
  }
}

export async function POST(req:Request){
  const {actorId,denied}=await access(); if(denied) return denied;
  try{
    const body=await req.json().catch(()=>null);
    const draftId=String(body?.draftId||"").trim();
    const s=await state(draftId);
    const e=eligible(s,draftId);
    if(!e.eligible) return NextResponse.json({success:false,reason:e.reason,error:"MediRef cannot be resumed from the current workflow state."},{status:409});

    const parent=s.parent!;
    const options=parent.request.options;
    const response=await withWorkflowExecution<Response>({intentId:parent.id,actor:options.actor},()=>sendViaMediref(new Request(req.url,{
      method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...options,draftId})
    })));
    const result=await response.clone().json().catch(()=>({}));
    if(!response.ok||result.success!==true){
      return NextResponse.json({success:false,reason:"preparation_failed",error:result.error||"MediRef preparation could not be confirmed."},{status:response.status||500});
    }
    return NextResponse.json({success:true,accepted:true,jobId:result.jobId||null,actorUserId:actorId,
      message:"MediRef preparation resumed. Praktika will not be uploaded again."},{status:202});
  }catch{
    return NextResponse.json({success:false,error:"MediRef resume acknowledgement is unavailable. Refresh before trying again."},{status:503});
  }
}
