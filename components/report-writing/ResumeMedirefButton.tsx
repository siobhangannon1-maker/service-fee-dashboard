"use client";
import { useEffect, useRef, useState } from "react";

export function ResumeMedirefButton({draftId,onQueued}:{draftId:string;onQueued:()=>void}) {
  const [eligible,setEligible]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const [confirming,setConfirming]=useState(false);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState("");
  const submitting=useRef(false);

  useEffect(()=>{
    const controller=new AbortController();
    setEligible(false); setLoaded(false); setConfirming(false); setMessage("");
    void (async()=>{
      try {
        const response=await fetch(`/api/report-writing/resume-mediref?draftId=${encodeURIComponent(draftId)}`,{cache:"no-store",signal:controller.signal});
        const result=await response.json().catch(()=>({}));
        if(!controller.signal.aborted) setEligible(response.ok&&result.eligible===true);
      } catch {
        if(!controller.signal.aborted) setEligible(false);
      } finally {
        if(!controller.signal.aborted) setLoaded(true);
      }
    })();
    return()=>controller.abort();
  },[draftId]);

  async function resume(){
    if(!eligible||!confirming||busy||submitting.current)return;
    submitting.current=true; setBusy(true); setMessage("");
    try{
      const response=await fetch("/api/report-writing/resume-mediref",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({draftId})});
      const result=await response.json().catch(()=>({}));
      if(!response.ok||result.success!==true){setMessage(result.error||"MediRef could not be resumed. Refresh before trying again.");return;}
      setConfirming(false); setEligible(false); onQueued();
    }catch{
      setMessage("MediRef resume acknowledgement is unavailable. Refresh before trying again.");
    }finally{
      submitting.current=false; setBusy(false);
    }
  }

  // Fail closed: ordinary Approved rows and lookup failures render nothing.
  if(!loaded||!eligible)return null;

  return <div className="mt-2 text-xs" aria-label="MediRef recovery">
    {!confirming ? <button type="button" disabled={busy} className="rounded border px-3 py-2" onClick={()=>{setMessage("");setConfirming(true);}}>Resume MediRef</button>
    : <div role="alertdialog" aria-label="Resume MediRef" className="space-y-2 rounded border p-2">
        <p>Praktika recovery is complete and no MediRef job exists. Resume MediRef preparation?</p>
        <p>This will not upload the letter to Praktika or update the Praktika icon again.</p>
        <button type="button" disabled={busy} className="mr-2 rounded border px-2 py-1" onClick={()=>{setConfirming(false);setMessage("");}}>Cancel</button>
        <button type="button" disabled={busy} className="rounded border px-2 py-1" onClick={resume}>{busy?"Resuming…":"Yes — resume MediRef"}</button>
      </div>}
    {message&&<p role="status">{message}</p>}
  </div>;
}
