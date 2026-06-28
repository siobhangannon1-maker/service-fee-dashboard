import ProcurementCard from "@/components/procurement/ProcurementCard";
import ProcurementPageHeader from "@/components/procurement/ProcurementPageHeader";
import EmptyState from "@/components/procurement/EmptyState";

export default function DeliveriesPage() {
  return (
    <div className="p-6 space-y-6">
      <ProcurementPageHeader
        badge="Receiving"
        title="Deliveries"
        description="Fast incoming stock workflow. Invoices do not automatically increase stock until delivery is confirmed."
      />

      <ProcurementCard title="Incoming stock">
        <EmptyState
          title="Delivery workflow planned"
          description="Staff should be able to confirm a delivery in less than 30 seconds with an All Received button."
        />
      </ProcurementCard>
    </div>
  );
}