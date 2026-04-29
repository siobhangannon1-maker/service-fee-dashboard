import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export default async function EmployeeMappingPage() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: xeroEmployees, error: xeroError } = await supabase
    .from("staff_wage_lines")
    .select("employee_name")
    .not("employee_name", "is", null)
    .order("employee_name");

  const { data: connecteamUsers, error: connecteamError } = await supabase
    .from("connecteam_users")
    .select("connecteam_user_id, display_name, email")
    .order("display_name");

  const { data: mappings, error: mappingError } = await supabase
    .from("employee_mapping")
    .select("*")
    .eq("is_active", true);

  if (xeroError || connecteamError || mappingError) {
    return (
      <main style={{ padding: 24 }}>
        <h1>Employee Mapping</h1>
        <p>Something went wrong loading the data.</p>
        <pre>
          {JSON.stringify(
            { xeroError, connecteamError, mappingError },
            null,
            2
          )}
        </pre>
      </main>
    );
  }

  const uniqueXeroEmployees = Array.from(
    new Map(
      (xeroEmployees || []).map((employee: any) => [
        employee.employee_name,
        employee,
      ])
    ).values()
  );

  return (
    <main style={{ padding: 24, maxWidth: 1100, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>Employee Mapping</h1>

      <p style={{ marginTop: 8, color: "#555" }}>
        Link each Xero employee name to the matching Connecteam user.
      </p>

      <div style={{ marginTop: 24 }}>
        {uniqueXeroEmployees.map((employee: any) => {
          const xeroEmployeeId = employee.employee_name;

          const existingMapping = (mappings || []).find(
            (mapping: any) => mapping.xero_employee_id === xeroEmployeeId
          );

          return (
            <form
              key={xeroEmployeeId}
              action="/api/connecteam/employee-mapping/save"
              method="POST"
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr auto",
                gap: 12,
                alignItems: "center",
                padding: 16,
                border: "1px solid #ddd",
                borderRadius: 12,
                marginBottom: 12,
              }}
            >
              <div>
                <div style={{ fontWeight: 600 }}>
                  {employee.employee_name}
                </div>
                <div style={{ fontSize: 12, color: "#777" }}>
                  Xero key: {xeroEmployeeId}
                </div>
              </div>

              <input
                type="hidden"
                name="xero_employee_id"
                value={xeroEmployeeId}
              />

              <input
                type="hidden"
                name="xero_employee_name"
                value={employee.employee_name}
              />

              <select
                name="connecteam_user_id"
                defaultValue={existingMapping?.connecteam_user_id || ""}
                required
                style={{
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid #ccc",
                }}
              >
                <option value="">Select Connecteam user</option>

                {(connecteamUsers || []).map((user: any) => (
                  <option
                    key={user.connecteam_user_id}
                    value={user.connecteam_user_id}
                  >
                    {user.display_name || user.email || user.connecteam_user_id}
                  </option>
                ))}
              </select>

              <button
                type="submit"
                style={{
                  padding: "10px 14px",
                  borderRadius: 8,
                  border: "none",
                  background: "#111",
                  color: "white",
                  cursor: "pointer",
                }}
              >
                Save
              </button>
            </form>
          );
        })}
      </div>
    </main>
  );
}