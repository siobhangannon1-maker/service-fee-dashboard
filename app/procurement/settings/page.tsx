import ProcurementCard from "@/components/procurement/ProcurementCard";
import ProcurementPageHeader from "@/components/procurement/ProcurementPageHeader";
import EmptyState from "@/components/procurement/EmptyState";

export default function ProcurementSettingsPage() {
  return (
    <div className="p-6 space-y-6">
      <ProcurementPageHeader
        badge="Configuration"
        title="Procurement Settings"
        description="Configure procurement rules, automation settings, freight assumptions and supplier connector behaviour."
      />

      <ProcurementCard title="Settings">
        <EmptyState
          title="Procurement settings planned"
          description="This will eventually control automation rules, approved substitutions, ordering thresholds and connector settings."
        />
      </ProcurementCard>
    </div>
  );
}