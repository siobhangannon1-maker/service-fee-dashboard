export default function ConnecteamPayrollImportPage() {
  return (
    <main style={{ padding: 24, maxWidth: 700, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>
        Import Connecteam Payroll Totals
      </h1>

      <p style={{ marginTop: 12, color: "#555" }}>
        Upload the Connecteam payroll totals CSV export. This is the file that
        includes Total work hours, Regular, and Total overtime.
      </p>

      <form
        action="/api/connecteam/payroll-totals/import"
        method="POST"
        encType="multipart/form-data"
        style={{
          marginTop: 24,
          padding: 20,
          border: "1px solid #ddd",
          borderRadius: 12,
        }}
      >
        <label style={{ display: "block", fontWeight: 600 }}>
          Connecteam CSV file
        </label>

        <input
          type="file"
          name="file"
          accept=".csv"
          required
          style={{ marginTop: 12 }}
        />

        <button
          type="submit"
          style={{
            display: "block",
            marginTop: 20,
            padding: "10px 16px",
            borderRadius: 8,
            border: "none",
            background: "#111",
            color: "white",
            cursor: "pointer",
          }}
        >
          Import CSV
        </button>
      </form>
    </main>
  );
}