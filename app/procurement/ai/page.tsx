import ProcurementCard from "@/components/procurement/ProcurementCard";
import ProcurementPageHeader from "@/components/procurement/ProcurementPageHeader";
import EmptyState from "@/components/procurement/EmptyState";

export default function ProcurementAIPage() {
  return (
    <div className="p-6 space-y-6">
      <ProcurementPageHeader
        badge="Procurement AI"
        title="AI Assistant"
        description="The future conversational layer for asking what to order today, which supplier is cheapest and whether stock should be transferred."
      />

      <ProcurementCard title="Assistant">
        <EmptyState
          title="Procurement AI will connect after the data foundation is ready"
          description="The assistant will use clinical products, supplier matches, price history, stock levels, orders and invoices."
        />
      </ProcurementCard>
    </div>
  );
}