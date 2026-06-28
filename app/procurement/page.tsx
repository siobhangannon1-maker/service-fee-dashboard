import Link from "next/link";
import ProcurementCard from "@/components/procurement/ProcurementCard";
import ProcurementPageHeader from "@/components/procurement/ProcurementPageHeader";
import StatusBadge from "@/components/procurement/StatusBadge";

const workspaces = [
  {
    title: "Price Intelligence",
    href: "/procurement/price-watch",
    description:
      "Compare supplier pricing, landed cost, freight and price history.",
    status: "Live foundation",
  },
  {
    title: "Clinical Products",
    href: "/procurement/products",
    description:
      "Master catalogue of the products your practices buy and track.",
    status: "Live foundation",
  },
  {
    title: "Supplier Matches",
    href: "/procurement/supplier-matches",
    description:
      "Approved links between clinical products and supplier SKUs.",
    status: "Next",
  },
  {
    title: "Suppliers",
    href: "/procurement/suppliers",
    description:
      "Supplier records, portals, freight rules and account information.",
    status: "Next",
  },
  {
    title: "Orders",
    href: "/procurement/orders",
    description:
      "Draft purchase orders, supplier baskets and approval workflows.",
    status: "Planned",
  },
  {
    title: "Deliveries",
    href: "/procurement/deliveries",
    description:
      "Fast receiving workflow before stock levels are increased.",
    status: "Planned",
  },
  {
    title: "Inventory",
    href: "/procurement/inventory",
    description:
      "Paddington and Coorparoo stock levels, stocktakes and transfers.",
    status: "Planned",
  },
  {
    title: "Procurement AI",
    href: "/procurement/ai",
    description:
      "Ask what to order today, where to save money and when to transfer stock.",
    status: "Planned",
  },
];

export default function ProcurementDashboardPage() {
  return (
    <div className="p-6 space-y-6">
      <ProcurementPageHeader
        badge="AI Procurement Intelligence"
        title="Procurement Dashboard"
        description="A first-class DocuDental workspace for supplier intelligence, price comparison, ordering, deliveries, inventory and AI procurement recommendations."
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <ProcurementCard title="Locations">
          <p className="text-3xl font-semibold">2</p>
          <p className="mt-1 text-sm text-gray-500">
            Paddington and Coorparoo
          </p>
        </ProcurementCard>

        <ProcurementCard title="Current focus">
          <p className="text-lg font-semibold">Price Intelligence</p>
          <p className="mt-1 text-sm text-gray-500">
            Build supplier matching before inventory.
          </p>
        </ProcurementCard>

        <ProcurementCard title="Decision rule">
          <p className="text-lg font-semibold">Landed cost</p>
          <p className="mt-1 text-sm text-gray-500">
            Never compare item price alone.
          </p>
        </ProcurementCard>

        <ProcurementCard title="Architecture">
          <p className="text-lg font-semibold">Production slice</p>
          <p className="mt-1 text-sm text-gray-500">
            No throwaway prototype.
          </p>
        </ProcurementCard>
      </div>

      <ProcurementCard
        title="Workspace roadmap"
        description="Each workspace builds on the same clinical product and supplier matching foundation."
      >
        <div className="grid gap-3 md:grid-cols-2">
          {workspaces.map((workspace) => (
            <Link
              key={workspace.href}
              href={workspace.href}
              className="rounded-lg border p-4 hover:bg-gray-50"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold">{workspace.title}</h3>
                  <p className="mt-1 text-sm text-gray-600">
                    {workspace.description}
                  </p>
                </div>

                <StatusBadge
                  variant={
                    workspace.status === "Next"
                      ? "approved"
                      : workspace.status === "Planned"
                        ? "pending"
                        : "active"
                  }
                >
                  {workspace.status}
                </StatusBadge>
              </div>
            </Link>
          ))}
        </div>
      </ProcurementCard>
    </div>
  );
}