"use client";

import { useState } from "react";

type ConnectionResult = {
  success: boolean;
  message: string;
  organisation?: {
    organisationId: string | null;
    name: string | null;
    shortCode: string | null;
    countryCode: string | null;
    baseCurrency: string | null;
  };
  rawResponse?: string;
  statusCode?: number;
};

type ProfitAndLossResult = {
  success: boolean;
  message: string;
  summary?: {
    reportYear: number;
    reportMonth: number;
    fromDate: string;
    toDate: string;
    reportName: string | null;
    reportType: string | null;
    topLevelRowCount: number;
    totalRowCount: number;
    reportTitles: string[];
  };
  samples?: {
    firstTopLevelRows: unknown[];
    firstMeaningfulRows: unknown[];
    firstSectionWithChildren: unknown;
    firstPotentialDetailRows: unknown[];
  };
  rawResponse?: string;
  statusCode?: number;
};

function getCurrentYear() {
  return new Date().getFullYear();
}

function getCurrentMonth() {
  return new Date().getMonth() + 1;
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div style={{ marginTop: "12px" }}>
      <strong>{label}</strong>
      <pre
        style={{
          marginTop: "8px",
          padding: "12px",
          borderRadius: "8px",
          background: "#0f172a",
          color: "#f8fafc",
          overflowX: "auto",
          fontSize: "12px",
          whiteSpace: "pre-wrap",
        }}
      >
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}

export default function XeroTestPage() {
  const [connectionLoading, setConnectionLoading] = useState(false);
  const [connectionResult, setConnectionResult] = useState<ConnectionResult | null>(null);

  const [profitAndLossLoading, setProfitAndLossLoading] = useState(false);
  const [profitAndLossResult, setProfitAndLossResult] = useState<ProfitAndLossResult | null>(null);

  const [year, setYear] = useState<number>(getCurrentYear());
  const [month, setMonth] = useState<number>(getCurrentMonth());

  async function handleTestConnection() {
    try {
      setConnectionLoading(true);
      setConnectionResult(null);

      const response = await fetch("/api/xero/test-connection", {
        method: "POST",
      });

      const responseText = await response.text();

      let parsed: ConnectionResult | null = null;

      try {
        parsed = JSON.parse(responseText) as ConnectionResult;
      } catch {
        parsed = {
          success: false,
          message: "The API route did not return valid JSON.",
          rawResponse: responseText,
          statusCode: response.status,
        };
      }

      if (!response.ok && !parsed.rawResponse) {
        parsed = {
          ...parsed,
          success: false,
          statusCode: response.status,
        };
      }

      setConnectionResult(parsed);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error calling test route";

      setConnectionResult({
        success: false,
        message,
      });
    } finally {
      setConnectionLoading(false);
    }
  }

  async function handleProfitAndLossSync() {
    try {
      setProfitAndLossLoading(true);
      setProfitAndLossResult(null);

      const response = await fetch("/api/xero/sync-profit-and-loss", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          year,
          month,
        }),
      });

      const responseText = await response.text();

      let parsed: ProfitAndLossResult | null = null;

      try {
        parsed = JSON.parse(responseText) as ProfitAndLossResult;
      } catch {
        parsed = {
          success: false,
          message: "The API route did not return valid JSON.",
          rawResponse: responseText,
          statusCode: response.status,
        };
      }

      if (!response.ok && !parsed.rawResponse) {
        parsed = {
          ...parsed,
          success: false,
          statusCode: response.status,
        };
      }

      setProfitAndLossResult(parsed);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error calling sync route";

      setProfitAndLossResult({
        success: false,
        message,
      });
    } finally {
      setProfitAndLossLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 980, margin: "40px auto", padding: "0 16px" }}>
      <h1 style={{ fontSize: "2rem", fontWeight: 700, marginBottom: "16px" }}>
        Xero Test Tools
      </h1>

      <p style={{ marginBottom: "24px", lineHeight: 1.6 }}>
        Use this page to test your Xero connection and inspect raw Profit and Loss
        rows before wiring them into your benchmark tables.
      </p>

      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: "12px",
          padding: "20px",
          marginBottom: "24px",
        }}
      >
        <h2 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "12px" }}>
          1. Test Xero Connection
        </h2>

        <button
          onClick={handleTestConnection}
          disabled={connectionLoading}
          style={{
            padding: "12px 18px",
            borderRadius: "8px",
            border: "1px solid #ccc",
            cursor: connectionLoading ? "not-allowed" : "pointer",
            fontWeight: 600,
          }}
        >
          {connectionLoading ? "Testing connection..." : "Test Xero Connection"}
        </button>

        {connectionResult && (
          <div
            style={{
              marginTop: "20px",
              padding: "16px",
              borderRadius: "8px",
              border: "1px solid #ddd",
              background: connectionResult.success ? "#f6fff8" : "#fff8f8",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            <p style={{ fontWeight: 700, marginBottom: "12px" }}>
              {connectionResult.success ? "Success" : "Error"}
            </p>

            {connectionResult.statusCode && (
              <p style={{ marginBottom: "12px" }}>
                <strong>Status code:</strong> {connectionResult.statusCode}
              </p>
            )}

            <p style={{ marginBottom: "12px" }}>{connectionResult.message}</p>

            {connectionResult.organisation && (
              <div style={{ lineHeight: 1.8 }}>
                <div>
                  <strong>Name:</strong> {connectionResult.organisation.name ?? "—"}
                </div>
                <div>
                  <strong>Organisation ID:</strong>{" "}
                  {connectionResult.organisation.organisationId ?? "—"}
                </div>
                <div>
                  <strong>Short Code:</strong>{" "}
                  {connectionResult.organisation.shortCode ?? "—"}
                </div>
                <div>
                  <strong>Country Code:</strong>{" "}
                  {connectionResult.organisation.countryCode ?? "—"}
                </div>
                <div>
                  <strong>Base Currency:</strong>{" "}
                  {connectionResult.organisation.baseCurrency ?? "—"}
                </div>
              </div>
            )}

            {connectionResult.rawResponse && (
              <div style={{ marginTop: "12px" }}>
                <strong>Raw response:</strong>
                <div style={{ marginTop: "8px" }}>{connectionResult.rawResponse}</div>
              </div>
            )}
          </div>
        )}
      </section>

      <section
        style={{
          border: "1px solid #ddd",
          borderRadius: "12px",
          padding: "20px",
        }}
      >
        <h2 style={{ fontSize: "1.25rem", fontWeight: 700, marginBottom: "12px" }}>
          2. Raw Profit and Loss Sync
        </h2>

        <p style={{ marginBottom: "16px", lineHeight: 1.6 }}>
          Choose a month, then fetch and store the raw Xero Profit and Loss report for
          that period.
        </p>

        <div
          style={{
            display: "flex",
            gap: "12px",
            alignItems: "flex-end",
            flexWrap: "wrap",
            marginBottom: "16px",
          }}
        >
          <div>
            <label
              htmlFor="pnl-year"
              style={{ display: "block", marginBottom: "6px", fontWeight: 600 }}
            >
              Year
            </label>
            <input
              id="pnl-year"
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              style={{
                padding: "10px 12px",
                borderRadius: "8px",
                border: "1px solid #ccc",
                width: "120px",
              }}
            />
          </div>

          <div>
            <label
              htmlFor="pnl-month"
              style={{ display: "block", marginBottom: "6px", fontWeight: 600 }}
            >
              Month
            </label>
            <input
              id="pnl-month"
              type="number"
              min={1}
              max={12}
              value={month}
              onChange={(e) => setMonth(Number(e.target.value))}
              style={{
                padding: "10px 12px",
                borderRadius: "8px",
                border: "1px solid #ccc",
                width: "120px",
              }}
            />
          </div>

          <button
            onClick={handleProfitAndLossSync}
            disabled={profitAndLossLoading}
            style={{
              padding: "12px 18px",
              borderRadius: "8px",
              border: "1px solid #ccc",
              cursor: profitAndLossLoading ? "not-allowed" : "pointer",
              fontWeight: 600,
            }}
          >
            {profitAndLossLoading ? "Syncing raw P&L..." : "Sync Raw Profit & Loss"}
          </button>
        </div>

        {profitAndLossResult && (
          <div
            style={{
              marginTop: "20px",
              padding: "16px",
              borderRadius: "8px",
              border: "1px solid #ddd",
              background: profitAndLossResult.success ? "#f6fff8" : "#fff8f8",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            <p style={{ fontWeight: 700, marginBottom: "12px" }}>
              {profitAndLossResult.success ? "Success" : "Error"}
            </p>

            {profitAndLossResult.statusCode && (
              <p style={{ marginBottom: "12px" }}>
                <strong>Status code:</strong> {profitAndLossResult.statusCode}
              </p>
            )}

            <p style={{ marginBottom: "12px" }}>{profitAndLossResult.message}</p>

            {profitAndLossResult.summary && (
              <div style={{ lineHeight: 1.8, marginBottom: "12px" }}>
                <div>
                  <strong>Period:</strong> {profitAndLossResult.summary.reportYear}-
                  {String(profitAndLossResult.summary.reportMonth).padStart(2, "0")}
                </div>
                <div>
                  <strong>From:</strong> {profitAndLossResult.summary.fromDate}
                </div>
                <div>
                  <strong>To:</strong> {profitAndLossResult.summary.toDate}
                </div>
                <div>
                  <strong>Report Name:</strong>{" "}
                  {profitAndLossResult.summary.reportName ?? "—"}
                </div>
                <div>
                  <strong>Report Type:</strong>{" "}
                  {profitAndLossResult.summary.reportType ?? "—"}
                </div>
                <div>
                  <strong>Top-level row count:</strong>{" "}
                  {profitAndLossResult.summary.topLevelRowCount}
                </div>
                <div>
                  <strong>Total row count:</strong>{" "}
                  {profitAndLossResult.summary.totalRowCount}
                </div>
              </div>
            )}

            {profitAndLossResult.samples?.firstTopLevelRows && (
              <JsonBlock
                label="First top-level rows"
                value={profitAndLossResult.samples.firstTopLevelRows}
              />
            )}

            {profitAndLossResult.samples?.firstMeaningfulRows && (
              <JsonBlock
                label="First meaningful rows"
                value={profitAndLossResult.samples.firstMeaningfulRows}
              />
            )}

            {profitAndLossResult.samples?.firstSectionWithChildren && (
              <JsonBlock
                label="First section with children"
                value={profitAndLossResult.samples.firstSectionWithChildren}
              />
            )}

            {profitAndLossResult.samples?.firstPotentialDetailRows && (
              <JsonBlock
                label="First potential detail rows"
                value={profitAndLossResult.samples.firstPotentialDetailRows}
              />
            )}

            {profitAndLossResult.rawResponse && (
              <div style={{ marginTop: "12px" }}>
                <strong>Raw response:</strong>
                <div style={{ marginTop: "8px" }}>{profitAndLossResult.rawResponse}</div>
              </div>
            )}
          </div>
        )}
      </section>
    </main>
  );
}