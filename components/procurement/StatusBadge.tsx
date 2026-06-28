const styles: Record<string, string> = {
  active: "bg-green-50 text-green-700 border-green-200",
  archived: "bg-gray-50 text-gray-700 border-gray-200",
  pending: "bg-yellow-50 text-yellow-700 border-yellow-200",
  approved: "bg-blue-50 text-blue-700 border-blue-200",
  warning: "bg-orange-50 text-orange-700 border-orange-200",
  danger: "bg-red-50 text-red-700 border-red-200",
  ai: "bg-purple-50 text-purple-700 border-purple-200",
};

export default function StatusBadge({
  children,
  variant = "active",
}: {
  children: React.ReactNode;
  variant?: keyof typeof styles;
}) {
  return (
    <span
      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${
        styles[variant] ?? styles.active
      }`}
    >
      {children}
    </span>
  );
}