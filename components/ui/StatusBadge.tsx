export default function StatusBadge({
  status,
}: {
  status: "open" | "locked" | "success" | "error";
}) {
  const styles = {
    open: "bg-emerald-100 text-emerald-700",
    locked: "bg-amber-100 text-amber-700",
    success: "bg-blue-100 text-blue-700",
    error: "bg-red-100 text-red-700",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}