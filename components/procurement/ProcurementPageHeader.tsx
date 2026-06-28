export default function ProcurementPageHeader({
  title,
  description,
  badge,
}: {
  title: string;
  description?: string;
  badge?: string;
}) {
  return (
    <div>
      {badge && (
        <p className="mb-1 text-sm font-medium text-blue-600">{badge}</p>
      )}

      <h1 className="text-2xl font-semibold">{title}</h1>

      {description && (
        <p className="mt-2 max-w-3xl text-sm text-gray-600">{description}</p>
      )}
    </div>
  );
}