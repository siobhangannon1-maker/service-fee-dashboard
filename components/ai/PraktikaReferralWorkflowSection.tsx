"use client";

import PraktikaReferrerMatchPanel from "@/components/ai/PraktikaReferrerMatchPanel";
import CreatePraktikaReferralButton from "@/components/ai/CreatePraktikaReferralButton";
import CompleteReferralWorkflowButton from "@/components/ai/CompleteReferralWorkflowButton";

type InboxItem = {
  id: string;
  praktika_patient_id?: string | null;
  praktika_referral_id?: string | number | null;
  praktika_filing_status?: string | null;
  praktika_referrer_party_id?: string | number | null;
  praktika_matched_referrer_party_id?: string | number | null;
  referrer_party_id?: string | number | null;
  praktika_referral_party_id?: string | number | null;
  referral_workflow_status?: string | null;
  referral_workflow_result?: any;
  archived_at?: string | null;
};

export default function PraktikaReferralWorkflowSection({
  inboxItem,
  onUpdated,
}: {
  inboxItem: InboxItem;
  onUpdated?: (item: any) => void | Promise<void>;
}) {
  if (!inboxItem?.id) return null;

  return (
    <div key={inboxItem.id} className="space-y-5">
      <PraktikaReferrerMatchPanel
        key={`referrer-match-${inboxItem.id}`}
        inboxItem={inboxItem}
        onUpdated={onUpdated}
      />

      <CreatePraktikaReferralButton
        key={`create-referral-${inboxItem.id}`}
        inboxItem={inboxItem}
        onCreated={onUpdated}
      />

      <CompleteReferralWorkflowButton
        key={`complete-referral-${inboxItem.id}`}
        inboxItem={inboxItem}
        onComplete={onUpdated}
      />
    </div>
  );
}