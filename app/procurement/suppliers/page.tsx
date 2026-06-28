import ProcurementCard from "@/components/procurement/ProcurementCard";
import ProcurementPageHeader from "@/components/procurement/ProcurementPageHeader";
import EmptyState from "@/components/procurement/EmptyState";

export default function SuppliersPage() {
  return (
    <div className="p-6 space-y-6">
      <ProcurementPageHeader
        badge="Supplier Intelligence"
        title="Suppliers"
        description="Manage supplier records, websites, account notes, freight rules and connector readiness."
      />

      <ProcurementCard title="Supplier directory">
        <EmptyState
          title="Supplier management coming next"
          description="Henry Schein, Orien Dental, Adam Dental and future suppliers will be managed here."
        />
      </ProcurementCard>
    </div>
  );
}