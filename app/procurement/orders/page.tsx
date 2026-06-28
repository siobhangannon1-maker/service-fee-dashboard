import ProcurementCard from "@/components/procurement/ProcurementCard";
import ProcurementPageHeader from "@/components/procurement/ProcurementPageHeader";
import EmptyState from "@/components/procurement/EmptyState";

export default function OrdersPage() {
  return (
    <div className="p-6 space-y-6">
      <ProcurementPageHeader
        badge="Ordering"
        title="Orders"
        description="Draft supplier baskets, approve purchases and eventually automate supplier cart creation."
      />

      <ProcurementCard title="Purchase orders">
        <EmptyState
          title="Ordering will be built after Price Intelligence"
          description="The Price Finder already stores supplier, SKU, URL, image and price, so ordering can be layered on naturally."
        />
      </ProcurementCard>
    </div>
  );
}