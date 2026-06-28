import Link from "next/link";

const navItems = [
  { href: "/procurement", label: "Dashboard" },
  { href: "/procurement/price-watch", label: "Price Intelligence" },
  { href: "/procurement/products", label: "Clinical Products" },
  { href: "/procurement/supplier-matches", label: "Supplier Matches" },
  { href: "/procurement/suppliers", label: "Suppliers" },
  { href: "/procurement/orders", label: "Orders" },
  { href: "/procurement/deliveries", label: "Deliveries" },
  { href: "/procurement/inventory", label: "Inventory" },
  { href: "/procurement/ai", label: "Procurement AI" },
  { href: "/procurement/settings", label: "Settings" },
];

export default function ProcurementLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-gray-50">
      <div className="border-b bg-white">
        <div className="px-6 py-4">
          <p className="text-sm text-gray-500">DocuDental</p>
          <h1 className="text-2xl font-semibold">Procurement</h1>
          <p className="mt-1 text-sm text-gray-600">
            AI-powered price intelligence, ordering, inventory and supplier
            management.
          </p>
        </div>

        <nav className="flex gap-2 overflow-x-auto px-6 pb-3 text-sm">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-full border px-3 py-1.5 text-gray-700 hover:bg-gray-100"
            >
              {item.label}
            </Link>
          ))}
        </nav>
      </div>

      <main>{children}</main>
    </div>
  );
}