export default function UnauthorizedPage() {
  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto mt-20 max-w-md rounded-3xl border bg-white p-8 shadow-sm">
        <h1 className="text-2xl font-semibold">Access denied</h1>
        <p className="mt-2 text-sm text-slate-600">
          Your login does not have permission to view this page.
        </p>
      </div>
    </main>
  );
}