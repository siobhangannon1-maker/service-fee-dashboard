import ProcessImportButton from "./ProcessImportButton";

export default async function ImportDetailPage({
  params,
}: {
  params: Promise<{ importId: string }>;
}) {
  const { importId } = await params;

  return (
    <main style={{ padding: "24px", fontFamily: "Arial, sans-serif" }}>
      <h1 style={{ fontSize: "24px", fontWeight: "bold", marginBottom: "16px" }}>
        Import Details
      </h1>

      <div style={{ marginBottom: "16px" }}>
        <strong>Import ID:</strong> {importId}
      </div>

      <ProcessImportButton importId={importId} />
    </main>
  );
}