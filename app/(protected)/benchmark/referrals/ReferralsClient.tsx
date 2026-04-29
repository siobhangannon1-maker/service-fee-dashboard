"use client";

import { useEffect, useMemo, useState } from "react";
import Papa from "papaparse";
import {
  APIProvider,
  Map as GoogleMap,
  AdvancedMarker,
  InfoWindow,
  Pin,
  useMap,
} from "@vis.gl/react-google-maps";

type ReferralRow = {
  clinic_name: string;
  address: string;
  suburb: string;
  post_code: string;
  state: string;
  referral_count: number;
};

type NewReferrer = {
  id: string;
  clinic_name: string;
  address: string | null;
  suburb: string | null;
  post_code: string | null;
  state: string | null;
  created_at?: string | null;
};

type MapPoint = {
  referrer_id: string;
  clinic_name: string;
  address: string | null;
  suburb: string | null;
  post_code: string | null;
  state: string | null;
  latitude: number;
  longitude: number;
  referral_count: number;
};

type ClusterPoint = {
  id: string;
  latitude: number;
  longitude: number;
  referrer_count: number;
  referral_count: number;
  points: MapPoint[];
};

type HotspotArea = {
  id: string;
  suburb: string;
  post_code: string;
  latitude: number;
  longitude: number;
  referral_count: number;
  referrer_count: number;
};

type PreviousUpload = {
  id: string;
  file_name: string;
  week_start: string | null;
  week_end: string | null;
  created_at: string;
  record_count: number;
  total_referrals: number;
};

type PeriodMode =
  | "all"
  | "month"
  | "ato_quarter"
  | "calendar_year"
  | "financial_year"
  | "custom";

const practiceLocations = [
  {
    id: "focus-coorparoo",
    name: "Focus Dental Specialists Coorparoo",
    address: "377 Cavendish Rd, Coorparoo QLD 4151",
    lat: -27.506971,
    lng: 153.063376,
  },
  {
    id: "focus-paddington",
    name: "Focus Dental Specialists Paddington",
    address: "4/183 Given Tce, Paddington QLD 4065",
    lat: -27.4594,
    lng: 153.0008,
  },
];

const monthOptions = [
  { label: "January", value: "0" },
  { label: "February", value: "1" },
  { label: "March", value: "2" },
  { label: "April", value: "3" },
  { label: "May", value: "4" },
  { label: "June", value: "5" },
  { label: "July", value: "6" },
  { label: "August", value: "7" },
  { label: "September", value: "8" },
  { label: "October", value: "9" },
  { label: "November", value: "10" },
  { label: "December", value: "11" },
];

const atoQuarterOptions = [
  { label: "Q1: Jul–Sep", value: "q1" },
  { label: "Q2: Oct–Dec", value: "q2" },
  { label: "Q3: Jan–Mar", value: "q3" },
  { label: "Q4: Apr–Jun", value: "q4" },
];

export default function ReferralsClient() {
  const currentYear = new Date().getFullYear();

  const [fileName, setFileName] = useState("");
  const [weekStart, setWeekStart] = useState("");
  const [weekEnd, setWeekEnd] = useState("");
  const [rows, setRows] = useState<ReferralRow[]>([]);
  const [newReferrers, setNewReferrers] = useState<NewReferrer[]>([]);
  const [previousUploads, setPreviousUploads] = useState<PreviousUpload[]>([]);
  const [mapData, setMapData] = useState<MapPoint[]>([]);
  const [selectedPoint, setSelectedPoint] = useState<MapPoint | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<ClusterPoint | null>(
    null
  );
  const [selectedHotspot, setSelectedHotspot] = useState<HotspotArea | null>(
    null
  );

  const [loading, setLoading] = useState(false);
  const [mapLoading, setMapLoading] = useState(false);
  const [uploadsLoading, setUploadsLoading] = useState(false);
  const [newReferrersLoading, setNewReferrersLoading] = useState(false);
  const [message, setMessage] = useState("");

  const [showHotspots, setShowHotspots] = useState(true);
  const [enableClustering, setEnableClustering] = useState(true);

  const [periodMode, setPeriodMode] = useState<PeriodMode>("all");
  const [selectedMonth, setSelectedMonth] = useState(
    String(new Date().getMonth())
  );
  const [selectedMonthYear, setSelectedMonthYear] = useState(
    String(currentYear)
  );
  const [selectedAtoQuarter, setSelectedAtoQuarter] = useState("q1");
  const [selectedFinancialYearStart, setSelectedFinancialYearStart] = useState(
    String(new Date().getMonth() >= 6 ? currentYear : currentYear - 1)
  );
  const [selectedCalendarYear, setSelectedCalendarYear] = useState(
    String(currentYear)
  );
  const [filterStart, setFilterStart] = useState("");
  const [filterEnd, setFilterEnd] = useState("");

  const [mapZoom, setMapZoom] = useState(12);
  const [mapCenter, setMapCenter] = useState({ lat: -27.506971, lng: 153.063376 });

  const yearOptions = useMemo(() => {
    const years = [];
    for (let year = currentYear + 1; year >= currentYear - 8; year--) {
      years.push(String(year));
    }
    return years;
  }, [currentYear]);

  const financialYearOptions = useMemo(() => {
    const years = [];
    for (let year = currentYear + 1; year >= currentYear - 8; year--) {
      years.push(String(year));
    }
    return years;
  }, [currentYear]);

  const totalVisibleReferrals = useMemo(() => {
    return mapData.reduce(
      (sum, point) => sum + Number(point.referral_count || 0),
      0
    );
  }, [mapData]);

  const hotspotAreas = useMemo(() => {
    return buildHotspotAreas(mapData);
  }, [mapData]);

  const clusteredMapData = useMemo(() => {
    return buildClusters(mapData, mapZoom);
  }, [mapData, mapZoom]);

  const visibleSingleMarkers = useMemo(() => {
    if (!enableClustering) return mapData;

    return clusteredMapData
      .filter((cluster) => cluster.points.length === 1)
      .map((cluster) => cluster.points[0]);
  }, [enableClustering, clusteredMapData, mapData]);

  const visibleClusters = useMemo(() => {
    if (!enableClustering) return [];

    return clusteredMapData.filter((cluster) => cluster.points.length > 1);
  }, [enableClustering, clusteredMapData]);

  const mostRecentUpload = previousUploads[0];

  useEffect(() => {
    loadPreviousUploads();
    loadMapData("", "");
    loadNewReferrers();
  }, []);

  useEffect(() => {
    if (!showHotspots) {
      setSelectedHotspot(null);
    }
  }, [showHotspots]);

  useEffect(() => {
    if (!enableClustering) {
      setSelectedCluster(null);
    }
  }, [enableClustering]);

  async function loadNewReferrers() {
    setNewReferrersLoading(true);

    try {
      const res = await fetch("/api/referrals/new-referrers");
      const json = await res.json();

      if (!res.ok) {
        setMessage(json.error || "Could not load recent new referrers.");
        return;
      }

      setNewReferrers(json.newReferrers || []);
    } catch (error) {
      console.error(error);
      setMessage("Could not load recent new referrers.");
    } finally {
      setNewReferrersLoading(false);
    }
  }

  async function loadMapData(start: string, end: string) {
    setMapLoading(true);

    const params = new URLSearchParams();

    if (start) params.set("start", start);
    if (end) params.set("end", end);

    try {
      const res = await fetch(`/api/referrals/map-data?${params.toString()}`);
      const json = await res.json();

      if (!res.ok) {
        setMessage(json.error || "Could not load map data.");
        return;
      }

      setMapData(json.mapData || []);
    } catch (error) {
      console.error(error);
      setMessage("Could not load map data.");
    } finally {
      setMapLoading(false);
    }
  }

  async function loadPreviousUploads() {
    setUploadsLoading(true);

    try {
      const res = await fetch("/api/referrals/uploads");
      const json = await res.json();

      if (!res.ok) {
        setMessage(json.error || "Could not load previous uploads.");
        return;
      }

      setPreviousUploads(json.uploads || []);
    } catch (error) {
      console.error(error);
      setMessage("Could not load previous uploads.");
    } finally {
      setUploadsLoading(false);
    }
  }

  function handleFileUpload(file: File) {
    setFileName(file.name);
    setMessage("");

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results: any) => {
        const parsedRows: ReferralRow[] = results.data.map((row: any) => ({
          clinic_name: row["Clinic Name"]?.trim() || "",
          address: row["Address"]?.trim() || "",
          suburb: row["Suburb"]?.trim() || "",
          post_code: String(row["Post Code"] || "").trim(),
          state: row["State"]?.trim() || "",
          referral_count: Number(row["Referral Count"] || 0),
        }));

        setRows(parsedRows);
        setMessage(`${parsedRows.length} referral rows loaded from CSV.`);
      },
    });
  }

  async function saveUpload() {
    if (!weekStart || !weekEnd) {
      setMessage("Please choose a week start and week end date.");
      return;
    }

    if (rows.length === 0) {
      setMessage("Please upload a CSV first.");
      return;
    }

    try {
      setLoading(true);
      setMessage("Saving referral upload...");

      const res = await fetch("/api/referrals/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          rows,
          fileName,
          weekStart,
          weekEnd,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        setMessage(json.error || "Upload failed.");
        return;
      }

      const newReferrerCount = json.newReferrers?.length || 0;
      const createdTaskCount = json.createdTasks?.length || 0;

      setMessage(
        `Saved successfully. ${json.recordsInserted} referral record(s) saved. ${newReferrerCount} new referrer(s) detected. ${createdTaskCount} task(s) created.`
      );

      setRows([]);
      setFileName("");

      await loadPreviousUploads();
      await loadMapData(filterStart, filterEnd);
      await loadNewReferrers();
    } catch (error) {
      console.error(error);
      setMessage("Unexpected error while saving upload.");
    } finally {
      setLoading(false);
    }
  }

  async function updateUploadPeriod(
    uploadId: string,
    newWeekStart: string,
    newWeekEnd: string
  ) {
    const res = await fetch(`/api/referrals/uploads/${uploadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        weekStart: newWeekStart,
        weekEnd: newWeekEnd,
      }),
    });

    const json = await res.json();

    if (!res.ok) {
      setMessage(json.error || "Could not update upload period.");
      return;
    }

    setMessage("Upload period updated.");
    await loadPreviousUploads();
    await loadMapData(filterStart, filterEnd);
    await loadNewReferrers();
  }

  async function unlinkUploadPeriod(uploadId: string) {
    const confirmed = window.confirm(
      "Unlink this upload from its time period?"
    );

    if (!confirmed) return;

    await updateUploadPeriod(uploadId, "", "");
  }

  async function deleteUpload(uploadId: string) {
    const confirmed = window.confirm(
      "Delete this upload and its referral records? This cannot be undone."
    );

    if (!confirmed) return;

    const res = await fetch(`/api/referrals/uploads/${uploadId}`, {
      method: "DELETE",
    });

    const json = await res.json();

    if (!res.ok) {
      setMessage(json.error || "Could not delete upload.");
      return;
    }

    setMessage(
      `Upload deleted. ${
        json.deletedRecordsCount || 0
      } referral record(s) removed.`
    );

    await loadPreviousUploads();
    await loadMapData(filterStart, filterEnd);
    await loadNewReferrers();
  }

  function applyPeriodSelection() {
    const range = getSelectedPeriodRange();

    setFilterStart(range.start);
    setFilterEnd(range.end);
    loadMapData(range.start, range.end);
  }

  function clearDateFilter() {
    setPeriodMode("all");
    setFilterStart("");
    setFilterEnd("");
    loadMapData("", "");
  }

  function getSelectedPeriodRange() {
    if (periodMode === "all") {
      return { start: "", end: "" };
    }

    if (periodMode === "month") {
      const year = Number(selectedMonthYear);
      const month = Number(selectedMonth);
      const start = new Date(year, month, 1);
      const end = new Date(year, month + 1, 0);
      return { start: toDateInput(start), end: toDateInput(end) };
    }

    if (periodMode === "ato_quarter") {
      const range = getAtoQuarterRange(
        selectedAtoQuarter,
        Number(selectedFinancialYearStart)
      );
      return { start: toDateInput(range.start), end: toDateInput(range.end) };
    }

    if (periodMode === "calendar_year") {
      const year = Number(selectedCalendarYear);
      const start = new Date(year, 0, 1);
      const end = new Date(year, 11, 31);
      return { start: toDateInput(start), end: toDateInput(end) };
    }

    if (periodMode === "financial_year") {
      const year = Number(selectedFinancialYearStart);
      const start = new Date(year, 6, 1);
      const end = new Date(year + 1, 5, 30);
      return { start: toDateInput(start), end: toDateInput(end) };
    }

    return { start: filterStart, end: filterEnd };
  }

  function zoomIn() {
    setMapZoom((current) => Math.min(current + 1, 20));
  }

  function zoomOut() {
    setMapZoom((current) => Math.max(current - 1, 3));
  }

  function zoomToCluster(cluster: ClusterPoint) {
    setSelectedCluster(null);
    setSelectedPoint(null);
    setSelectedHotspot(null);
    setMapCenter({
      lat: Number(cluster.latitude),
      lng: Number(cluster.longitude),
    });
    setMapZoom((current) => Math.min(Math.max(current + 2, 13), 18));
  }

  return (
    <div style={pageStyle}>
      <section style={heroStyle}>
        <div>
          <div style={eyebrowStyle}>Clinical growth intelligence</div>
          <h1 style={heroTitleStyle}>Referral Tracking</h1>
          <p style={heroSubtitleStyle}>
            Map where referrals are coming from, identify new referrer
            relationships, and monitor local referral hotspots over time.
          </p>
        </div>

        <div style={heroStatsStyle}>
          <div style={heroStatCard}>
            <span style={heroStatLabel}>Referrers</span>
            <strong style={heroStatNumber}>{mapData.length}</strong>
          </div>
          <div style={heroStatCard}>
            <span style={heroStatLabel}>Referrals shown</span>
            <strong style={heroStatNumber}>{totalVisibleReferrals}</strong>
          </div>
          <div style={heroStatCard}>
            <span style={heroStatLabel}>Recent new</span>
            <strong style={heroStatNumber}>{newReferrers.length}</strong>
          </div>
        </div>
      </section>

      <div style={cardStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <p style={sectionKickerStyle}>Step 1</p>
            <h2 style={cardTitleStyle}>Upload weekly referral CSV</h2>
            <p style={subtleTextStyle}>
              The app checks each practice name against previous uploads and
              flags brand-new referrers automatically.
            </p>
          </div>
        </div>

        <div style={uploadGrid}>
          <label>
            Week Start
            <input
              type="date"
              value={weekStart}
              onChange={(e) => setWeekStart(e.target.value)}
              style={inputStyle}
            />
          </label>

          <label>
            Week End
            <input
              type="date"
              value={weekEnd}
              onChange={(e) => setWeekEnd(e.target.value)}
              style={inputStyle}
            />
          </label>

          <label>
            Upload Referral CSV
            <input
              type="file"
              accept=".csv"
              onChange={(e) => {
                if (e.target.files?.[0]) handleFileUpload(e.target.files[0]);
              }}
              style={fileInputStyle}
            />
          </label>

          <button onClick={saveUpload} disabled={loading} style={primaryButton}>
            {loading ? "Saving..." : "Save Referral Upload"}
          </button>
        </div>

        {fileName && (
          <p style={subtleTextStyle}>
            Selected file: <strong>{fileName}</strong>
          </p>
        )}

        {message && <div style={messageBox}>{message}</div>}
      </div>

      <div style={cardStyle}>
        <div style={sectionHeaderStyle}>
          <div>
            <p style={sectionKickerStyle}>Step 2</p>
            <h2 style={cardTitleStyle}>Referral map and activity panel</h2>
            <p style={subtleTextStyle}>
              The side panel shows recent new referrers loaded from the database,
              so it still works after refreshing the page.
            </p>
          </div>
        </div>

        <div style={summaryGrid}>
          <div style={summaryCard}>
            <strong>{mapData.length}</strong>
            <span>Referrers shown</span>
          </div>

          <div style={summaryCard}>
            <strong>{visibleClusters.length}</strong>
            <span>Visible clusters</span>
          </div>

          <div style={summaryCard}>
            <strong>{hotspotAreas.length}</strong>
            <span>Hotspot areas</span>
          </div>

          <div style={summaryCard}>
            <strong>{totalVisibleReferrals}</strong>
            <span>Total referrals shown</span>
          </div>

          <div style={summaryCard}>
            <strong>{mapLoading ? "Loading..." : "Ready"}</strong>
            <span>Map status</span>
          </div>
        </div>

        <div style={legendBox}>
          <strong>Map layers:</strong>

          <label style={toggleLabel}>
            <input
              type="checkbox"
              checked={showHotspots}
              onChange={(e) => setShowHotspots(e.target.checked)}
            />
            Show hotspot areas
          </label>

          <label style={toggleLabel}>
            <input
              type="checkbox"
              checked={enableClustering}
              onChange={(e) => setEnableClustering(e.target.checked)}
            />
            Cluster referrer pins
          </label>
        </div>

        {showHotspots && (
          <div style={legendBox}>
            <strong>Hotspot colours:</strong>
            <span style={{ ...legendDot, background: "#facc15" }} /> Low
            <span style={{ ...legendDot, background: "#fb923c" }} /> Medium
            <span style={{ ...legendDot, background: "#ef4444" }} /> High
            <span style={{ ...legendDot, background: "#7f1d1d" }} /> Very high
          </div>
        )}

        <div style={filterBox}>
          <label>
            Map Period
            <select
              value={periodMode}
              onChange={(e) => setPeriodMode(e.target.value as PeriodMode)}
              style={inputStyle}
            >
              <option value="all">All uploads</option>
              <option value="month">Month</option>
              <option value="ato_quarter">ATO quarter</option>
              <option value="calendar_year">Calendar year</option>
              <option value="financial_year">Financial year</option>
              <option value="custom">Custom dates</option>
            </select>
          </label>

          {periodMode === "month" && (
            <>
              <label>
                Month
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  style={inputStyle}
                >
                  {monthOptions.map((month) => (
                    <option key={month.value} value={month.value}>
                      {month.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Year
                <select
                  value={selectedMonthYear}
                  onChange={(e) => setSelectedMonthYear(e.target.value)}
                  style={inputStyle}
                >
                  {yearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          {periodMode === "ato_quarter" && (
            <>
              <label>
                ATO Quarter
                <select
                  value={selectedAtoQuarter}
                  onChange={(e) => setSelectedAtoQuarter(e.target.value)}
                  style={inputStyle}
                >
                  {atoQuarterOptions.map((quarter) => (
                    <option key={quarter.value} value={quarter.value}>
                      {quarter.label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Financial Year Starting
                <select
                  value={selectedFinancialYearStart}
                  onChange={(e) =>
                    setSelectedFinancialYearStart(e.target.value)
                  }
                  style={inputStyle}
                >
                  {financialYearOptions.map((year) => (
                    <option key={year} value={year}>
                      {year}–{Number(year) + 1}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}

          {periodMode === "calendar_year" && (
            <label>
              Calendar Year
              <select
                value={selectedCalendarYear}
                onChange={(e) => setSelectedCalendarYear(e.target.value)}
                style={inputStyle}
              >
                {yearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}
                  </option>
                ))}
              </select>
            </label>
          )}

          {periodMode === "financial_year" && (
            <label>
              Financial Year
              <select
                value={selectedFinancialYearStart}
                onChange={(e) => setSelectedFinancialYearStart(e.target.value)}
                style={inputStyle}
              >
                {financialYearOptions.map((year) => (
                  <option key={year} value={year}>
                    {year}–{Number(year) + 1}
                  </option>
                ))}
              </select>
            </label>
          )}

          {periodMode === "custom" && (
            <>
              <label>
                Start Date
                <input
                  type="date"
                  value={filterStart}
                  onChange={(e) => setFilterStart(e.target.value)}
                  style={inputStyle}
                />
              </label>

              <label>
                End Date
                <input
                  type="date"
                  value={filterEnd}
                  onChange={(e) => setFilterEnd(e.target.value)}
                  style={inputStyle}
                />
              </label>
            </>
          )}

          <div style={filterButtonGroup}>
            <button onClick={applyPeriodSelection} style={secondaryButton}>
              Apply
            </button>

            <button onClick={clearDateFilter} style={warningButton}>
              Clear
            </button>
          </div>
        </div>

        <div style={activePeriodBox}>
          <strong>Active map period:</strong>{" "}
          {filterStart || filterEnd
            ? `${filterStart || "Any start"} to ${filterEnd || "Any end"}`
            : "All uploads"}
        </div>

        <div style={mapAndPanelGrid}>
          <div style={mapShellStyle}>
            <div style={zoomControlsStyle}>
              <button onClick={zoomIn} style={zoomButtonStyle}>
                +
              </button>
              <button onClick={zoomOut} style={zoomButtonStyle}>
                −
              </button>
            </div>

            <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!}>
              <GoogleMap
                zoom={mapZoom}
                center={mapCenter}
                mapId="referral-map"
                disableDefaultUI={false}
                style={{ width: "100%", height: "100%" }}
                onCameraChanged={(event) => {
                  setMapZoom(event.detail.zoom);
                  setMapCenter(event.detail.center);
                }}
              >
                {showHotspots &&
                  hotspotAreas.map((area) => (
                    <HotspotCircle
                      key={area.id}
                      area={area}
                      onSelect={(area) => {
                        setSelectedPoint(null);
                        setSelectedCluster(null);
                        setSelectedHotspot(area);
                      }}
                    />
                  ))}

                {practiceLocations.map((location) => (
                  <AdvancedMarker
                    key={location.id}
                    position={{
                      lat: location.lat,
                      lng: location.lng,
                    }}
                  >
                    <div
                      title={`${location.name} — ${location.address}`}
                      style={{
                        display: "grid",
                        justifyItems: "center",
                        gap: 4,
                      }}
                    >
                      <Pin
                        background="#dc2626"
                        borderColor="#991b1b"
                        glyphColor="#ffffff"
                        glyph="F"
                      />
                      <div style={practiceLabelStyle}>Focus</div>
                    </div>
                  </AdvancedMarker>
                ))}

                {visibleClusters.map((cluster) => (
                  <AdvancedMarker
                    key={cluster.id}
                    position={{
                      lat: Number(cluster.latitude),
                      lng: Number(cluster.longitude),
                    }}
                    onClick={() => {
                      setSelectedPoint(null);
                      setSelectedHotspot(null);
                      setSelectedCluster(cluster);
                    }}
                  >
                    <ClusterMarker cluster={cluster} />
                  </AdvancedMarker>
                ))}

                {visibleSingleMarkers.map((point) => (
                  <AdvancedMarker
                    key={point.referrer_id}
                    position={{
                      lat: Number(point.latitude),
                      lng: Number(point.longitude),
                    }}
                    onClick={() => {
                      setSelectedCluster(null);
                      setSelectedHotspot(null);
                      setSelectedPoint(point);
                    }}
                  >
                    <ReferralMarker point={point} />
                  </AdvancedMarker>
                ))}

                {selectedPoint && (
                  <InfoWindow
                    position={{
                      lat: Number(selectedPoint.latitude),
                      lng: Number(selectedPoint.longitude),
                    }}
                    onCloseClick={() => setSelectedPoint(null)}
                  >
                    <div style={{ maxWidth: 220 }}>
                      <strong>{selectedPoint.clinic_name}</strong>
                      <br />
                      Referrals: {selectedPoint.referral_count}
                      <br />
                      {selectedPoint.address}
                      <br />
                      {selectedPoint.suburb} {selectedPoint.post_code}
                    </div>
                  </InfoWindow>
                )}

                {selectedCluster && (
                  <InfoWindow
                    position={{
                      lat: Number(selectedCluster.latitude),
                      lng: Number(selectedCluster.longitude),
                    }}
                    onCloseClick={() => setSelectedCluster(null)}
                  >
                    <div style={{ maxWidth: 260 }}>
                      <strong>{selectedCluster.referrer_count} referrers</strong>
                      <br />
                      Total referrals: {selectedCluster.referral_count}
                      <br />
                      <button
                        onClick={() => zoomToCluster(selectedCluster)}
                        style={{
                          ...secondaryButton,
                          marginTop: 10,
                          padding: "6px 10px",
                        }}
                      >
                        Zoom into cluster
                      </button>

                      <div style={{ marginTop: 10 }}>
                        {selectedCluster.points.slice(0, 6).map((point) => (
                          <div key={point.referrer_id} style={{ marginTop: 6 }}>
                            <strong>{point.clinic_name}</strong>
                            <br />
                            {point.referral_count} referrals
                          </div>
                        ))}

                        {selectedCluster.points.length > 6 && (
                          <p style={subtleTextStyle}>
                            +{selectedCluster.points.length - 6} more referrers
                          </p>
                        )}
                      </div>
                    </div>
                  </InfoWindow>
                )}

                {selectedHotspot && (
                  <InfoWindow
                    position={{
                      lat: Number(selectedHotspot.latitude),
                      lng: Number(selectedHotspot.longitude),
                    }}
                    onCloseClick={() => setSelectedHotspot(null)}
                  >
                    <div style={{ maxWidth: 240 }}>
                      <strong>
                        {selectedHotspot.suburb || "Unknown suburb"}{" "}
                        {selectedHotspot.post_code}
                      </strong>
                      <br />
                      Total referrals: {selectedHotspot.referral_count}
                      <br />
                      Referrers in area: {selectedHotspot.referrer_count}
                    </div>
                  </InfoWindow>
                )}
              </GoogleMap>
            </APIProvider>
          </div>

          <aside style={sidePanelStyle}>
            <div style={sidePanelHeaderStyle}>
              <p style={sectionKickerStyle}>Recent new referrers</p>
              <h3 style={{ margin: 0 }}>Database check</h3>
              <p style={subtleTextStyle}>
                Shows referrers created in the last 30 days.
              </p>
            </div>

            {newReferrersLoading ? (
              <div style={quietBoxStyle}>Loading recent new referrers...</div>
            ) : newReferrers.length > 0 ? (
              <div style={newReferrerListStyle}>
                <div style={alertBoxStyle}>
                  <strong>{newReferrers.length}</strong> recent new referrer
                  {newReferrers.length === 1 ? "" : "s"} detected.
                </div>

                {newReferrers.map((referrer) => (
                  <div key={referrer.id} style={newReferrerSideCard}>
                    <strong>{referrer.clinic_name}</strong>
                    <p style={subtleTextStyle}>
                      {referrer.address}
                      <br />
                      {referrer.suburb} {referrer.post_code}, {referrer.state}
                    </p>
                    <p style={newCommentStyle}>
                      Comment: This referrer was recently added to the referrer
                      database and may need follow-up.
                    </p>
                    {referrer.created_at && (
                      <p style={subtleTextStyle}>
                        Added{" "}
                        {new Date(referrer.created_at).toLocaleDateString(
                          "en-AU"
                        )}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div style={quietBoxStyle}>
                <strong>No recent new referrers detected.</strong>
                <p style={subtleTextStyle}>
                  After you save a weekly CSV, any practice names that have not
                  appeared before will be listed here for 30 days.
                </p>
              </div>
            )}

            <button
              onClick={loadNewReferrers}
              style={{ ...secondaryButton, marginTop: 12 }}
            >
              Refresh new referrers
            </button>

            <div style={sideDividerStyle} />

            <div>
              <p style={sectionKickerStyle}>Most recent upload</p>
              {mostRecentUpload ? (
                <div style={miniStatsCard}>
                  <strong>{mostRecentUpload.file_name || "Untitled upload"}</strong>
                  <p style={subtleTextStyle}>
                    {mostRecentUpload.week_start && mostRecentUpload.week_end
                      ? `${mostRecentUpload.week_start} to ${mostRecentUpload.week_end}`
                      : "No linked period"}
                  </p>
                  <div style={miniStatsGrid}>
                    <span>{mostRecentUpload.record_count} rows</span>
                    <span>{mostRecentUpload.total_referrals} referrals</span>
                  </div>
                </div>
              ) : (
                <p style={subtleTextStyle}>No uploads yet.</p>
              )}
            </div>
          </aside>
        </div>
      </div>

      {rows.length > 0 && (
        <div style={cardStyle}>
          <h2 style={cardTitleStyle}>CSV Preview</h2>

          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={cellStyle}>Practice Name</th>
                <th style={cellStyle}>Suburb</th>
                <th style={cellStyle}>Referrals</th>
              </tr>
            </thead>

            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  <td style={cellStyle}>{row.clinic_name}</td>
                  <td style={cellStyle}>{row.suburb}</td>
                  <td style={cellStyle}>{row.referral_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={cardStyle}>
        <div style={downloadsHeader}>
          <div>
            <p style={sectionKickerStyle}>File management</p>
            <h2 style={cardTitleStyle}>Previous Referral Uploads</h2>
            <p style={subtleTextStyle}>
              Manage uploaded files and the reporting period linked to each
              upload.
            </p>
          </div>

          <button onClick={loadPreviousUploads} style={secondaryButton}>
            Refresh
          </button>
        </div>

        {uploadsLoading && <p>Loading previous uploads...</p>}

        {!uploadsLoading && previousUploads.length === 0 && (
          <div style={emptyStateBox}>No previous uploads found.</div>
        )}

        {!uploadsLoading && previousUploads.length > 0 && (
          <div style={uploadCardGrid}>
            {previousUploads.map((upload) => (
              <UploadCard
                key={upload.id}
                upload={upload}
                onUpdate={updateUploadPeriod}
                onUnlink={unlinkUploadPeriod}
                onDelete={deleteUpload}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function HotspotCircle({
  area,
  onSelect,
}: {
  area: HotspotArea;
  onSelect: (area: HotspotArea) => void;
}) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    const referralCount = Number(area.referral_count || 0);
    const hotspotColour = getHotspotColour(referralCount);

    const circle = new google.maps.Circle({
      map,
      center: {
        lat: Number(area.latitude),
        lng: Number(area.longitude),
      },
      radius: getHotspotRadius(referralCount),
      fillColor: hotspotColour,
      fillOpacity: 0.34,
      strokeColor: hotspotColour,
      strokeOpacity: 0.85,
      strokeWeight: 2,
      clickable: true,
      zIndex: 1,
    });

    const clickListener = circle.addListener("click", () => {
      onSelect(area);
    });

    return () => {
      google.maps.event.removeListener(clickListener);
      circle.setMap(null);
    };
  }, [
    map,
    area.id,
    area.latitude,
    area.longitude,
    area.referral_count,
    onSelect,
    area,
  ]);

  return null;
}

function ReferralMarker({ point }: { point: MapPoint }) {
  const referralCount = Number(point.referral_count || 0);

  return (
    <div
      title={`${point.clinic_name} — ${referralCount} referrals`}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
      }}
    >
      <Pin
        background="#2563eb"
        borderColor="#1e40af"
        glyphColor="#ffffff"
        glyph={String(referralCount)}
      />
    </div>
  );
}

function ClusterMarker({ cluster }: { cluster: ClusterPoint }) {
  const size = Math.min(46 + cluster.referrer_count * 5, 80);

  return (
    <div
      title={`${cluster.referrer_count} referrers — ${cluster.referral_count} referrals`}
      style={{
        width: size,
        height: size,
        borderRadius: "999px",
        background: "#7c3aed",
        border: "3px solid white",
        color: "white",
        display: "grid",
        placeItems: "center",
        boxShadow: "0 3px 12px rgba(0,0,0,0.35)",
        cursor: "pointer",
        fontWeight: 800,
      }}
    >
      <div style={{ textAlign: "center", lineHeight: 1.1 }}>
        <div>{cluster.referrer_count}</div>
        <div style={{ fontSize: 10 }}>refs</div>
      </div>
    </div>
  );
}

function UploadCard({
  upload,
  onUpdate,
  onUnlink,
  onDelete,
}: {
  upload: PreviousUpload;
  onUpdate: (uploadId: string, weekStart: string, weekEnd: string) => void;
  onUnlink: (uploadId: string) => void;
  onDelete: (uploadId: string) => void;
}) {
  const [editWeekStart, setEditWeekStart] = useState(upload.week_start || "");
  const [editWeekEnd, setEditWeekEnd] = useState(upload.week_end || "");

  return (
    <div style={uploadCard}>
      <div style={uploadCardTop}>
        <div>
          <strong>{upload.file_name || "Untitled upload"}</strong>
          <p style={subtleTextStyle}>
            Uploaded {new Date(upload.created_at).toLocaleDateString("en-AU")}
          </p>
        </div>

        <div style={badgeStyle}>{upload.total_referrals} referrals</div>
      </div>

      <div style={uploadStatsGrid}>
        <div>
          <span style={statLabel}>Rows</span>
          <strong>{upload.record_count}</strong>
        </div>
        <div>
          <span style={statLabel}>Linked period</span>
          <strong>
            {upload.week_start && upload.week_end
              ? `${upload.week_start} to ${upload.week_end}`
              : "Unlinked"}
          </strong>
        </div>
      </div>

      <div style={dateEditGrid}>
        <label>
          Start
          <input
            type="date"
            value={editWeekStart}
            onChange={(e) => setEditWeekStart(e.target.value)}
            style={inputStyle}
          />
        </label>

        <label>
          End
          <input
            type="date"
            value={editWeekEnd}
            onChange={(e) => setEditWeekEnd(e.target.value)}
            style={inputStyle}
          />
        </label>
      </div>

      <div style={uploadActionRow}>
        <button
          style={secondaryButton}
          onClick={() => onUpdate(upload.id, editWeekStart, editWeekEnd)}
        >
          Link / Update
        </button>

        <button style={warningButton} onClick={() => onUnlink(upload.id)}>
          Unlink
        </button>

        <button style={dangerButton} onClick={() => onDelete(upload.id)}>
          Delete
        </button>
      </div>
    </div>
  );
}

function buildClusters(points: MapPoint[], zoom: number) {
  if (zoom >= 14) {
    return points.map((point) => ({
      id: point.referrer_id,
      latitude: Number(point.latitude),
      longitude: Number(point.longitude),
      referrer_count: 1,
      referral_count: Number(point.referral_count || 0),
      points: [point],
    }));
  }

  const gridSize = getClusterGridSize(zoom);
  const grouped = new globalThis.Map<
    string,
    {
      latTotal: number;
      lngTotal: number;
      referrer_count: number;
      referral_count: number;
      points: MapPoint[];
    }
  >();

  for (const point of points) {
    if (!point.latitude || !point.longitude) continue;

    const lat = Number(point.latitude);
    const lng = Number(point.longitude);

    const latBucket = Math.round(lat / gridSize);
    const lngBucket = Math.round(lng / gridSize);
    const key = `${latBucket}-${lngBucket}`;

    const existing = grouped.get(key);

    if (existing) {
      existing.latTotal += lat;
      existing.lngTotal += lng;
      existing.referrer_count += 1;
      existing.referral_count += Number(point.referral_count || 0);
      existing.points.push(point);
    } else {
      grouped.set(key, {
        latTotal: lat,
        lngTotal: lng,
        referrer_count: 1,
        referral_count: Number(point.referral_count || 0),
        points: [point],
      });
    }
  }

  return Array.from(grouped.entries()).map(([id, cluster]) => ({
    id,
    latitude: cluster.latTotal / cluster.referrer_count,
    longitude: cluster.lngTotal / cluster.referrer_count,
    referrer_count: cluster.referrer_count,
    referral_count: cluster.referral_count,
    points: cluster.points,
  }));
}

function getClusterGridSize(zoom: number) {
  if (zoom <= 8) return 0.12;
  if (zoom <= 9) return 0.08;
  if (zoom <= 10) return 0.045;
  if (zoom <= 11) return 0.025;
  if (zoom <= 12) return 0.014;
  if (zoom <= 13) return 0.008;
  return 0.003;
}

function buildHotspotAreas(points: MapPoint[]) {
  const grouped = new globalThis.Map<
    string,
    {
      suburb: string;
      post_code: string;
      referral_count: number;
      referrer_count: number;
      latTotal: number;
      lngTotal: number;
    }
  >();

  for (const point of points) {
    if (!point.latitude || !point.longitude) continue;

    const suburb = point.suburb || "Unknown suburb";
    const postCode = point.post_code || "Unknown postcode";
    const key = `${suburb.toLowerCase()}-${postCode}`;

    const existing = grouped.get(key);

    if (existing) {
      existing.referral_count += Number(point.referral_count || 0);
      existing.referrer_count += 1;
      existing.latTotal += Number(point.latitude);
      existing.lngTotal += Number(point.longitude);
    } else {
      grouped.set(key, {
        suburb,
        post_code: postCode,
        referral_count: Number(point.referral_count || 0),
        referrer_count: 1,
        latTotal: Number(point.latitude),
        lngTotal: Number(point.longitude),
      });
    }
  }

  return Array.from(grouped.entries()).map(([id, area]) => ({
    id,
    suburb: area.suburb,
    post_code: area.post_code,
    referral_count: area.referral_count,
    referrer_count: area.referrer_count,
    latitude: area.latTotal / area.referrer_count,
    longitude: area.lngTotal / area.referrer_count,
  }));
}

function getHotspotColour(referralCount: number) {
  if (referralCount >= 20) return "#7f1d1d";
  if (referralCount >= 10) return "#ef4444";
  if (referralCount >= 5) return "#fb923c";
  return "#facc15";
}

function getHotspotRadius(referralCount: number) {
  if (referralCount >= 20) return 3600;
  if (referralCount >= 10) return 2800;
  if (referralCount >= 5) return 2100;
  return 1400;
}

function getAtoQuarterRange(quarter: string, financialYearStart: number) {
  if (quarter === "q1") {
    return {
      start: new Date(financialYearStart, 6, 1),
      end: new Date(financialYearStart, 8, 30),
    };
  }

  if (quarter === "q2") {
    return {
      start: new Date(financialYearStart, 9, 1),
      end: new Date(financialYearStart, 11, 31),
    };
  }

  if (quarter === "q3") {
    return {
      start: new Date(financialYearStart + 1, 0, 1),
      end: new Date(financialYearStart + 1, 2, 31),
    };
  }

  return {
    start: new Date(financialYearStart + 1, 3, 1),
    end: new Date(financialYearStart + 1, 5, 30),
  };
}

function toDateInput(date: Date) {
  return date.toISOString().split("T")[0];
}

const pageStyle: React.CSSProperties = {
  padding: 24,
  display: "grid",
  gap: 24,
  background: "#f8fafc",
};

const heroStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1.4fr) minmax(280px, 0.8fr)",
  gap: 24,
  alignItems: "stretch",
  padding: 28,
  borderRadius: 24,
  background:
    "linear-gradient(135deg, #0f172a 0%, #1e3a8a 52%, #2563eb 100%)",
  color: "white",
  boxShadow: "0 18px 35px rgba(15, 23, 42, 0.20)",
};

const eyebrowStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "6px 10px",
  borderRadius: 999,
  background: "rgba(255,255,255,0.14)",
  border: "1px solid rgba(255,255,255,0.2)",
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  marginBottom: 14,
};

const heroTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 42,
  lineHeight: 1.05,
  letterSpacing: "-0.04em",
};

const heroSubtitleStyle: React.CSSProperties = {
  margin: "14px 0 0",
  maxWidth: 780,
  color: "rgba(255,255,255,0.84)",
  fontSize: 16,
  lineHeight: 1.6,
};

const heroStatsStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: 12,
  alignSelf: "end",
};

const heroStatCard: React.CSSProperties = {
  padding: 14,
  borderRadius: 16,
  background: "rgba(255,255,255,0.12)",
  border: "1px solid rgba(255,255,255,0.18)",
  backdropFilter: "blur(8px)",
};

const heroStatLabel: React.CSSProperties = {
  display: "block",
  color: "rgba(255,255,255,0.72)",
  fontSize: 12,
  marginBottom: 6,
};

const heroStatNumber: React.CSSProperties = {
  fontSize: 26,
  lineHeight: 1,
};

const cardStyle: React.CSSProperties = {
  padding: 20,
  border: "1px solid #e5e7eb",
  borderRadius: 18,
  background: "white",
  boxShadow: "0 1px 3px rgba(15,23,42,0.06)",
};

const sectionHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "start",
  gap: 16,
  marginBottom: 16,
};

const sectionKickerStyle: React.CSSProperties = {
  margin: "0 0 5px",
  color: "#2563eb",
  fontSize: 12,
  fontWeight: 800,
  textTransform: "uppercase",
  letterSpacing: "0.08em",
};

const cardTitleStyle: React.CSSProperties = {
  marginTop: 0,
  marginBottom: 6,
  fontSize: 22,
  letterSpacing: "-0.02em",
  color: "#111827",
};

const uploadGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 16,
  alignItems: "end",
};

const inputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  padding: 9,
  marginTop: 6,
  border: "1px solid #d1d5db",
  borderRadius: 8,
};

const fileInputStyle: React.CSSProperties = {
  display: "block",
  width: "100%",
  marginTop: 8,
};

const mapAndPanelGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(520px, 1fr) 340px",
  gap: 16,
  alignItems: "stretch",
};

const mapShellStyle: React.CSSProperties = {
  height: 620,
  width: "100%",
  border: "1px solid #ddd",
  borderRadius: 16,
  overflow: "hidden",
  position: "relative",
};

const sidePanelStyle: React.CSSProperties = {
  height: 620,
  overflow: "auto",
  padding: 16,
  border: "1px solid #e5e7eb",
  borderRadius: 16,
  background: "#f9fafb",
};

const sidePanelHeaderStyle: React.CSSProperties = {
  marginBottom: 14,
};

const newReferrerListStyle: React.CSSProperties = {
  display: "grid",
  gap: 12,
};

const alertBoxStyle: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  background: "#ecfdf5",
  border: "1px solid #bbf7d0",
  color: "#166534",
};

const newReferrerSideCard: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  background: "white",
  border: "1px solid #e5e7eb",
};

const newCommentStyle: React.CSSProperties = {
  margin: "8px 0 0",
  padding: 10,
  borderRadius: 10,
  background: "#eff6ff",
  color: "#1e40af",
  fontSize: 12,
  lineHeight: 1.45,
};

const quietBoxStyle: React.CSSProperties = {
  padding: 14,
  borderRadius: 12,
  background: "white",
  border: "1px dashed #d1d5db",
};

const sideDividerStyle: React.CSSProperties = {
  height: 1,
  background: "#e5e7eb",
  margin: "18px 0",
};

const miniStatsCard: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  background: "white",
  border: "1px solid #e5e7eb",
};

const miniStatsGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 8,
  marginTop: 10,
  color: "#374151",
  fontSize: 13,
};

const zoomControlsStyle: React.CSSProperties = {
  position: "absolute",
  top: 16,
  right: 16,
  zIndex: 10,
  display: "grid",
  gap: 8,
};

const zoomButtonStyle: React.CSSProperties = {
  width: 42,
  height: 42,
  borderRadius: 8,
  border: "1px solid #d1d5db",
  background: "white",
  fontSize: 24,
  fontWeight: 700,
  cursor: "pointer",
  boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
};

const filterBox: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))",
  gap: 12,
  alignItems: "end",
  marginBottom: 12,
  padding: 16,
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  background: "#f9fafb",
};

const filterButtonGroup: React.CSSProperties = {
  display: "flex",
  gap: 8,
  alignItems: "end",
};

const activePeriodBox: React.CSSProperties = {
  marginBottom: 14,
  padding: 10,
  border: "1px solid #dbeafe",
  borderRadius: 10,
  background: "#eff6ff",
  color: "#1e3a8a",
};

const summaryGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
  gap: 12,
  marginBottom: 16,
};

const summaryCard: React.CSSProperties = {
  display: "grid",
  gap: 4,
  padding: 14,
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  background: "#ffffff",
};

const legendBox: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  flexWrap: "wrap",
  marginBottom: 12,
  padding: 12,
  border: "1px solid #e5e7eb",
  borderRadius: 12,
  background: "white",
};

const toggleLabel: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "6px 10px",
  border: "1px solid #e5e7eb",
  borderRadius: 999,
  background: "#f9fafb",
};

const legendDot: React.CSSProperties = {
  display: "inline-block",
  width: 14,
  height: 14,
  borderRadius: 999,
  marginLeft: 8,
  border: "1px solid rgba(0,0,0,0.2)",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  marginTop: 12,
};

const cellStyle: React.CSSProperties = {
  border: "1px solid #e5e7eb",
  padding: 8,
  textAlign: "left",
  verticalAlign: "top",
};

const primaryButton: React.CSSProperties = {
  padding: "10px 14px",
  background: "#111827",
  color: "white",
  border: "none",
  borderRadius: 8,
  cursor: "pointer",
};

const secondaryButton: React.CSSProperties = {
  padding: "8px 12px",
  background: "#2563eb",
  color: "white",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
};

const warningButton: React.CSSProperties = {
  padding: "8px 12px",
  background: "#f59e0b",
  color: "white",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
};

const dangerButton: React.CSSProperties = {
  padding: "8px 12px",
  background: "#dc2626",
  color: "white",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
};

const practiceLabelStyle: React.CSSProperties = {
  background: "white",
  border: "1px solid #d1d5db",
  borderRadius: 6,
  padding: "2px 6px",
  fontSize: 11,
  fontWeight: 700,
  boxShadow: "0 2px 6px rgba(0,0,0,0.15)",
  whiteSpace: "nowrap",
};

const subtleTextStyle: React.CSSProperties = {
  margin: "4px 0",
  color: "#6b7280",
  fontSize: 13,
};

const messageBox: React.CSSProperties = {
  marginTop: 14,
  padding: 12,
  background: "#f3f4f6",
  border: "1px solid #e5e7eb",
  borderRadius: 10,
};

const downloadsHeader: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 16,
  alignItems: "center",
  marginBottom: 16,
};

const emptyStateBox: React.CSSProperties = {
  padding: 20,
  border: "1px dashed #d1d5db",
  borderRadius: 12,
  background: "#f9fafb",
  color: "#6b7280",
};

const uploadCardGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(330px, 1fr))",
  gap: 16,
};

const uploadCard: React.CSSProperties = {
  padding: 16,
  border: "1px solid #e5e7eb",
  borderRadius: 14,
  background: "#f9fafb",
};

const uploadCardTop: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: 12,
  alignItems: "start",
  marginBottom: 14,
};

const badgeStyle: React.CSSProperties = {
  padding: "5px 8px",
  borderRadius: 999,
  background: "#dbeafe",
  color: "#1e40af",
  fontSize: 12,
  fontWeight: 700,
  whiteSpace: "nowrap",
};

const uploadStatsGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 2fr",
  gap: 10,
  padding: 12,
  borderRadius: 10,
  background: "white",
  marginBottom: 12,
};

const statLabel: React.CSSProperties = {
  display: "block",
  color: "#6b7280",
  fontSize: 12,
  marginBottom: 3,
};

const dateEditGrid: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "1fr 1fr",
  gap: 10,
};

const uploadActionRow: React.CSSProperties = {
  display: "flex",
  gap: 8,
  flexWrap: "wrap",
  marginTop: 12,
};
