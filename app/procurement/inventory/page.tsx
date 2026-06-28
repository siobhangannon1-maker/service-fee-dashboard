import ProcurementCard from "@/components/procurement/ProcurementCard";
import ProcurementPageHeader from "@/components/procurement/ProcurementPageHeader";
import EmptyState from "@/components/procurement/EmptyState";

export default function InventoryPage() {
  return (
    <div className="p-6 space-y-6">
      <ProcurementPageHeader
        badge="Multi-location Inventory"
        title="Inventory"
        description="Paddington and Coorparoo stock levels, reorder points, stocktakes, transfers and expiry management."
      />

      <ProcurementCard title="Stock levels">
        <EmptyState
          title="Inventory is Phase 3"
          description="We are intentionally building Price Intelligence first so inventory sits on top of products, supplier matches, SKUs and ordering history."
        />
      </ProcurementCard>
    </div>
  );
}