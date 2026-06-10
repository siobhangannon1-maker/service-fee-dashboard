"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import PraktikaToolsPopup from "@/components/report-writing/PraktikaToolsPopup";
import ReferrerSearchBox from "@/components/report-writing/ReferrerSearchBox";
import RichTextLetterEditor from "@/components/report-writing/RichTextLetterEditor";

type AppointmentType = {
  value: string;
  label: string;
};

type ReportTypeOption = {
  value: string;
  label: string;
};

type Candidate = {
  id?: string | number;
  patientNumber?: string | number | null;
  firstName?: string | null;
  lastName?: string | null;
  dob?: string | null;
  mobile?: string | null;
  matchScore?: number | null;
  matchReason?: string | null;
};

type StructuredField = {
  id?: string;
  field_key: string;
  label: string;
  placeholder?: string | null;
  input_type?: string | null;
  display_order?: number | null;
  required?: boolean | null;
};

type ScribeSession = {
  id: string;
  provider_id: string;
  patient_first_name: string;
  patient_last_name: string;
  patient_dob: string | null;
  praktika_patient_id: string | null;
  appointment_type: string;
  transcript: string | null;
  structured_data: Record<string, string> | null;
  ai_generated_note: string | null;
  edited_note: string | null;
  status: string;
  uploaded_to_praktika: boolean;
  uploaded_to_praktika_at: string | null;
  praktika_note_id: string | null;
  created_at: string;
  updated_at: string;
};

type SidebarView = "drafts" | "approved" | "uploaded";

async function readJsonSafely(response: Response) {
  const text = await response.text();

  if (!text.trim()) {
    return { success: false, error: "Empty server response." };
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      success: false,
      error: "Server returned non-JSON response.",
      preview: text.slice(0, 500),
    };
  }
}

function cleanString(value: unknown) {
  return String(value ?? "").trim();
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "Not recorded";

  try {
    return new Date(value).toLocaleString("en-AU");
  } catch {
    return value;
  }
}

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(
    2,
    "0",
  )}`;
}

function formatAppointmentType(value: string | null | undefined) {
  return String(value || "clinical note")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatManualReferrerAddress(referrer: any) {
  const practiceName = String(
    referrer?.practice_name ||
      referrer?.practiceName ||
      referrer?.clinic_name ||
      referrer?.clinicName ||
      referrer?.practice ||
      referrer?.raw_json?.vchClinic ||
      "",
  ).trim();

  const address = String(referrer?.address || "").trim();

  if (!practiceName) return address;
  if (!address) return practiceName;

  const firstAddressLine = address.split(/\n+/)[0]?.trim().toLowerCase();

  if (firstAddressLine === practiceName.toLowerCase()) {
    return address;
  }

  return [practiceName, address].filter(Boolean).join("\n");
}

function TrashBinIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-4.5 w-4.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 7L18.132 19.142C18.058 20.173 17.199 21 16.165 21H7.835C6.801 21 5.942 20.173 5.868 19.142L5 7M10 11V17M14 11V17M4 7H20M9 7V4C9 3.448 9.448 3 10 3H14C14.552 3 15 3.448 15 4V7"
      />
    </svg>
  );
}

export default function ProviderClinicalScribeClient({
  providerId,
}: {
  providerId: string;
}) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const today = new Date().toISOString().slice(0, 10);

  const [praktikaToolsOpen, setPraktikaToolsOpen] = useState(false);
  const [queueFromDate, setQueueFromDate] = useState(today);
  const [queueToDate, setQueueToDate] = useState(today);
  const [praktikaMessage, setPraktikaMessage] = useState<string | null>(null);

  const [sidebarView, setSidebarView] = useState<SidebarView>("drafts");
  const [searchText, setSearchText] = useState("");

  const [sessions, setSessions] = useState<ScribeSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<ScribeSession | null>(
    null,
  );

  const [appointmentTypes, setAppointmentTypes] = useState<AppointmentType[]>([
    { value: "periodontal_consultation", label: "Periodontal Consultation" },
  ]);

  const [appointmentType, setAppointmentType] = useState(
    "periodontal_consultation",
  );

  const [structuredFields, setStructuredFields] = useState<StructuredField[]>(
    [],
  );

  const [patientFirstName, setPatientFirstName] = useState("");
  const [patientLastName, setPatientLastName] = useState("");
  const [patientDob, setPatientDob] = useState("");
  const [praktikaPatientId, setPraktikaPatientId] = useState("");
  const [praktikaPatientNumber, setPraktikaPatientNumber] = useState("");

  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [matching, setMatching] = useState(false);

  const [transcript, setTranscript] = useState("");
  const [structuredData, setStructuredData] = useState<Record<string, string>>(
    {},
  );

  const [sessionId, setSessionId] = useState("");
  const [generatedNote, setGeneratedNote] = useState("");
  const [editedNote, setEditedNote] = useState("");
  const [approved, setApproved] = useState(false);

  const [recording, setRecording] = useState(false);
  const [paused, setPaused] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [showSavedToast, setShowSavedToast] = useState(false);
  const [savedToastText, setSavedToastText] = useState("");

  const [letterPanelOpen, setLetterPanelOpen] = useState(false);
  const [reportTypes, setReportTypes] = useState<ReportTypeOption[]>([
    { value: "consultation_report", label: "Consultation Report" },
  ]);
  const [reportType, setReportType] = useState("consultation_report");
  const [referrerName, setReferrerName] = useState("");
  const [referrerAddress, setReferrerAddress] = useState("");
  const [typistInstructions, setTypistInstructions] = useState("");
  const [letterText, setLetterText] = useState("");
  const [originalLetterText, setOriginalLetterText] = useState("");
  const [letterDraftId, setLetterDraftId] = useState("");
  const [letterSaveStatus, setLetterSaveStatus] = useState<
    "idle" | "saving" | "saved" | "error"
  >("idle");

  const patientName = `${patientFirstName} ${patientLastName}`.trim();

  const draftSessions = sessions.filter(
    (session) =>
      session.status !== "approved" &&
      session.status !== "uploaded_to_praktika",
  );

  const approvedSessions = sessions.filter(
    (session) => session.status === "approved",
  );

  const uploadedSessions = sessions.filter(
    (session) => session.status === "uploaded_to_praktika",
  );

  const visibleSessions = useMemo(() => {
    const base =
      sidebarView === "drafts"
        ? draftSessions
        : sidebarView === "approved"
          ? approvedSessions
          : uploadedSessions;

    const query = searchText.trim().toLowerCase();

    if (!query) return base;

    return base.filter((session) =>
      [
        session.patient_first_name,
        session.patient_last_name,
        session.patient_dob,
        session.appointment_type,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [sidebarView, searchText, sessions]);

  useEffect(() => {
    loadAppointmentTypes();
    loadStructuredFields();
    loadSessions();
    loadReportTypes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadStructuredFields();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appointmentType]);

  useEffect(() => {
    if (!recording || paused) return;

    const timer = window.setInterval(() => {
      setRecordingSeconds((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(timer);
  }, [recording, paused]);

  async function loadAppointmentTypes() {
    const response = await fetch(
      `/api/clinical-scribe/appointment-types?providerId=${providerId}`,
    );

    const data = await readJsonSafely(response);

    if (data.success) {
      const types: AppointmentType[] = data.types || [];

      if (types.length > 0) {
        setAppointmentTypes(types);

        if (!types.some((type) => type.value === appointmentType)) {
          setAppointmentType(types[0].value);
        }
      }
    }
  }

  async function loadReportTypes() {
    const response = await fetch(
      `/api/report-writing/correspondence-types?providerId=${providerId}`,
    );

    const data = await readJsonSafely(response);

    if (data.success) {
      const types: ReportTypeOption[] = data.types || [];

      if (types.length > 0) {
        setReportTypes(types);

        if (!types.some((type) => type.value === reportType)) {
          setReportType(types[0].value);
        }
      }
    }
  }

  async function loadStructuredFields() {
    const response = await fetch(
      `/api/clinical-scribe/structured-fields?providerId=${providerId}&appointmentType=${appointmentType}`,
    );

    const data = await readJsonSafely(response);

    if (data.success) {
      setStructuredFields(data.fields || []);
    }
  }

  async function loadSessions() {
    const response = await fetch(
      `/api/clinical-scribe/sessions?providerId=${providerId}`,
    );

    const data = await readJsonSafely(response);

    if (data.success) {
      setSessions(data.sessions || []);
    }
  }

  function showToast(text: string) {
    setSavedToastText(text);
    setShowSavedToast(true);

    window.setTimeout(() => {
      setShowSavedToast(false);
    }, 4500);
  }

  function resetLetterPanel() {
    setLetterPanelOpen(false);
    setReferrerName("");
    setReferrerAddress("");
    setTypistInstructions("");
    setLetterText("");
    setOriginalLetterText("");
    setLetterDraftId("");
    setLetterSaveStatus("idle");
  }

  function resetEditor() {
    setSelectedSession(null);
    setPatientFirstName("");
    setPatientLastName("");
    setPatientDob("");
    setPraktikaPatientId("");
    setPraktikaPatientNumber("");
    setCandidates([]);
    setTranscript("");
    setStructuredData({});
    setSessionId("");
    setGeneratedNote("");
    setEditedNote("");
    setApproved(false);
    setRecording(false);
    setPaused(false);
    setRecordingSeconds(0);
    setMessage("");
    resetLetterPanel();
  }

  function loadSessionIntoEditor(session: ScribeSession) {
    setSelectedSession(session);
    setPatientFirstName(session.patient_first_name || "");
    setPatientLastName(session.patient_last_name || "");
    setPatientDob(session.patient_dob || "");
    setPraktikaPatientId(session.praktika_patient_id || "");
    setPraktikaPatientNumber("");
    setAppointmentType(session.appointment_type || "periodontal_consultation");
    setTranscript(session.transcript || "");
    setStructuredData(session.structured_data || {});
    setSessionId(session.id);
    setGeneratedNote(session.ai_generated_note || "");
    setEditedNote(session.edited_note || "");
    setApproved(
      session.status === "approved" || session.status === "uploaded_to_praktika",
    );
    setCandidates([]);
    setMessage(`Opened note saved ${formatDateTime(session.updated_at)}.`);
    resetLetterPanel();
  }

  function updateStructuredField(key: string, value: string) {
    setStructuredData((current) => ({
      ...current,
      [key]: value,
    }));
  }

  async function handleSyncQueue() {
    setPraktikaMessage(
      "Queue sync is not needed for clinical scribe yet. Praktika connection tools are available here for patient matching and clinical note upload.",
    );
  }

  async function handleSyncReferrers() {
    setPraktikaMessage(
      "Referrer sync is not needed for clinical scribe yet. Praktika connection tools are available here for patient matching and clinical note upload.",
    );
  }

  async function findPraktikaMatches() {
    if (!patientFirstName.trim() || !patientLastName.trim()) {
      alert("Enter patient first and last name before matching.");
      return;
    }

    if (!patientDob.trim()) {
      alert("Enter DOB before matching.");
      return;
    }

    setMatching(true);
    setMessage("Searching Praktika for matching patients...");
    setCandidates([]);

    try {
      const response = await fetch("/api/clinical-scribe/praktika-match", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          firstName: patientFirstName,
          lastName: patientLastName,
          dob: patientDob,
          patientName,
          patientDob,
        }),
      });

      const data = await readJsonSafely(response);

      if (!response.ok || !data.success) {
        alert(data.error || "Could not search Praktika patients.");
        return;
      }

      const foundCandidates: Candidate[] = data.candidates || [];
      setCandidates(foundCandidates);

      if (foundCandidates.length === 1) {
        selectCandidate(foundCandidates[0]);
        setMessage("Single likely Praktika match selected.");
        return;
      }

      setMessage(
        foundCandidates.length > 0
          ? "Select the correct Praktika patient match."
          : "No Praktika matches found.",
      );
    } catch (error) {
      console.error(error);
      alert("Error searching Praktika patients.");
    } finally {
      setMatching(false);
    }
  }

  function selectCandidate(candidate: Candidate) {
    const patientId = candidate.id ? String(candidate.id) : "";

    if (!patientId) return;

    setPraktikaPatientId(patientId);
    setPraktikaPatientNumber(
      candidate.patientNumber ? String(candidate.patientNumber) : "",
    );

    setMessage(
      `Selected Praktika patient: ${
        [candidate.firstName, candidate.lastName].filter(Boolean).join(" ") ||
        patientName
      }`,
    );
  }

  async function startRecording() {
    if (!patientFirstName.trim() || !patientLastName.trim()) {
      alert("Enter patient first and last name before recording.");
      return;
    }

    setMessage("");
    chunksRef.current = [];
    setRecordingSeconds(0);

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: true,
    });

    const recorder = new MediaRecorder(stream, {
      mimeType: "audio/webm",
    });

    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };

    recorder.onstop = async () => {
      stream.getTracks().forEach((track) => track.stop());

      const blob = new Blob(chunksRef.current, {
        type: "audio/webm",
      });

      await transcribeAudio(blob);
    };

    recorder.start();
    setRecording(true);
    setPaused(false);
    setMessage("Recording consultation...");
  }

  function pauseRecording() {
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.pause();
      setPaused(true);
      setMessage("Recording paused.");
    }
  }

  function resumeRecording() {
    if (mediaRecorderRef.current?.state === "paused") {
      mediaRecorderRef.current.resume();
      setPaused(false);
      setMessage("Recording consultation...");
    }
  }

  function stopRecording() {
    if (!mediaRecorderRef.current) return;

    mediaRecorderRef.current.stop();
    setRecording(false);
    setPaused(false);
    setWorking(true);
    setMessage("Transcribing consultation...");
  }

  async function transcribeAudio(audioBlob: Blob) {
  try {
    if (audioBlob.size === 0) {
      alert("No audio was recorded.");
      return;
    }

    const formData = new FormData();
    formData.append("file", audioBlob, "clinical-scribe.webm");

    const response = await fetch("/api/report-writing/transcribe-audio", {
      method: "POST",
      body: formData,
    });

    const data = await readJsonSafely(response);

    if (!response.ok || !data.success) {
      alert(data.error || "Failed to transcribe audio.");
      return;
    }

    const temporaryTranscript = data.text || data.transcript || "";

    if (!temporaryTranscript.trim()) {
      alert("No usable consultation text was produced.");
      return;
    }

    await generateNoteFromTemporaryTranscript(temporaryTranscript);
  } catch (error) {
    console.error(error);
    alert("Error processing consultation audio.");
  } finally {
    setWorking(false);
  }
}
  async function saveSession(status = "draft") {
    if (!patientFirstName.trim() || !patientLastName.trim()) {
      alert("Patient first and last name are required.");
      return null;
    }

    setWorking(true);

    try {
      const response = await fetch("/api/clinical-scribe/sessions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId,
          sessionId,
          patientFirstName,
          patientLastName,
          patientDob,
          praktikaPatientId,
          appointmentType,
          transcript,
          structuredData,
          aiGeneratedNote: generatedNote,
          editedNote,
          status,
        }),
      });

      const data = await readJsonSafely(response);

      if (!response.ok || !data.success) {
        alert(data.error || "Failed to save clinical note draft.");
        return null;
      }

      setSessionId(data.session.id);
      setSelectedSession(data.session);
      showToast("Clinical note draft saved.");
      await loadSessions();

      return data.session as ScribeSession;
    } finally {
      setWorking(false);
    }
  }

  async function generateNote() {
    if (!patientFirstName.trim() || !patientLastName.trim()) {
      alert("Enter patient first and last name.");
      return;
    }

    if (!transcript.trim() && !Object.values(structuredData).some(Boolean)) {
      alert("Enter a transcript or structured clinical data first.");
      return;
    }

    setWorking(true);
    setMessage("Generating clinical note...");

    try {
      const response = await fetch("/api/clinical-scribe/generate-note", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId,
          patientFirstName,
          patientLastName,
          patientDob,
          praktikaPatientId,
          appointmentType,
          transcript,
          structuredData,
        }),
      });

      const data = await readJsonSafely(response);

      if (!response.ok || !data.success) {
        alert(data.error || "Failed to generate clinical note.");
        return;
      }

      setSessionId(data.sessionId);
      setGeneratedNote(data.note);
      setEditedNote(data.note);
      setApproved(false);
      setMessage("Clinical note generated. Review and edit before approval.");
      await loadSessions();
    } catch (error) {
      console.error(error);
      alert("Error generating clinical note.");
    } finally {
      setWorking(false);
    }
  }

  async function approveNote() {
    if (!editedNote.trim()) {
      alert("Generate or enter a clinical note first.");
      return;
    }

    const saved = await saveSession("approved");

    if (saved) {
      setApproved(true);
      setMessage("Clinical note approved. You can now write it to Praktika or create a letter.");
      showToast("Clinical note approved.");
      setSidebarView("approved");
      await loadSessions();
    }
  }

  async function writeClinicalNoteToPraktika() {
    if (!sessionId) {
      alert("Save or generate the note first.");
      return;
    }

    if (!approved) {
      alert("Approve the clinical note before writing it to Praktika.");
      return;
    }

    if (!praktikaPatientId.trim()) {
      alert("Match a Praktika patient before writing the clinical note.");
      return;
    }

    if (!editedNote.trim()) {
      alert("Clinical note is empty.");
      return;
    }

    const confirmed = confirm(
      `Write this approved clinical note to Praktika for ${patientName}?`,
    );

    if (!confirmed) return;

    setWorking(true);
    setMessage("Writing approved clinical note to Praktika...");

    try {
      const response = await fetch("/api/clinical-scribe/upload-to-praktika", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sessionId,
          praktikaPatientId,
          editedNote,
          practiceId: 1181,
        }),
      });

      const data = await readJsonSafely(response);

      if (!response.ok || !data.success) {
        alert(data.error || "Failed to write clinical note to Praktika.");
        return;
      }

      setMessage(
        data.praktikaNoteId
          ? `Clinical note written to Praktika. Note ID: ${data.praktikaNoteId}`
          : "Clinical note written to Praktika.",
      );
      showToast("Clinical note written to Praktika.");
      setSidebarView("uploaded");
      await loadSessions();
    } catch (error) {
      console.error(error);
      alert("Error writing clinical note to Praktika.");
    } finally {
      setWorking(false);
    }
  }

  async function deleteSession(session: ScribeSession | null) {
    if (!session) return;

    const confirmed = confirm(
      `Delete this clinical note for ${session.patient_first_name} ${session.patient_last_name}?`,
    );

    if (!confirmed) return;

    setWorking(true);

    try {
      const response = await fetch("/api/clinical-scribe/sessions/delete", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId,
          sessionId: session.id,
        }),
      });

      const data = await readJsonSafely(response);

      if (!response.ok || !data.success) {
        alert(data.error || "Failed to delete clinical note.");
        return;
      }

      if (sessionId === session.id) {
        resetEditor();
      }

      await loadSessions();
    } finally {
      setWorking(false);
    }
  }

  async function generateLetterFromApprovedNote() {
    if (!approved) {
      alert("Approve the clinical note before creating a letter.");
      return;
    }

    if (!editedNote.trim()) {
      alert("There is no approved clinical note to turn into a letter.");
      return;
    }

    if (!patientFirstName.trim() || !patientLastName.trim()) {
      alert("Patient first and last name are required.");
      return;
    }

    setWorking(true);
    setMessage("Generating letter from approved clinical note...");

    try {
      const response = await fetch("/api/report-writing/generate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId,
          patientName,
          patientFirstName,
          patientDob,
          patientGender: "neutral",
          referrerName,
          referrerAddress,
          reportType,
          clinicalNotes: editedNote,
        }),
      });

      const data = await readJsonSafely(response);

      if (!response.ok || !data.success) {
        alert(data.error || "Failed to generate letter.");
        return;
      }

      setLetterText(data.report || "");
      setOriginalLetterText(data.report || "");
      setLetterPanelOpen(true);
      setLetterSaveStatus("idle");
      setMessage("Letter draft generated. Review, save or approve.");
    } catch (error) {
      console.error(error);
      alert("Error generating letter.");
    } finally {
      setWorking(false);
    }
  }

  async function saveLetterDraft(status: "draft" | "approved" = "draft") {
    if (!letterText.trim()) {
      alert("Generate or enter the letter text first.");
      return;
    }

    if (!patientFirstName.trim() || !patientLastName.trim()) {
      alert("Patient first and last name are required.");
      return;
    }

    if (status === "approved") {
      const confirmed = confirm("Approve this letter now?");
      if (!confirmed) return;
    }

    setLetterSaveStatus("saving");
    setWorking(true);

    try {
      if (letterDraftId) {
        const response = await fetch("/api/report-writing/update-draft", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            draftId: letterDraftId,
            editedText: letterText,
            status,
            patientName,
            patientDob,
            referrerName,
            referrerAddress,
            reportType,
            clinicalNotes: editedNote,
            originalAiText: originalLetterText || letterText,
            finalApprovedText: letterText,
            learnFromEdits:
              status === "approved" &&
              Boolean(originalLetterText.trim()) &&
              originalLetterText.trim() !== letterText.trim(),
            learningSource: "clinical_scribe_letter_approval",
            typistInstructions,
          }),
        });

        const data = await readJsonSafely(response);

        if (!response.ok || !data.success) {
          setLetterSaveStatus("error");
          alert(data.error || "Failed to update letter draft.");
          return;
        }

        setLetterSaveStatus("saved");
        setMessage(
          status === "approved"
            ? "Letter approved and moved to Approved Letters."
            : "Letter draft saved.",
        );
        showToast(
          status === "approved"
            ? "Letter approved."
            : "Letter draft saved.",
        );
        return;
      }

      const response = await fetch("/api/report-writing/save-draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          providerId,
          patientName,
          patientDob,
          referrerName,
          referrerAddress,
          reportType,
          clinicalNotes: editedNote,
          typistInstructions,
          generatedReport: originalLetterText || letterText,
          editedText: letterText,
          originalAiText: originalLetterText || letterText,
          finalApprovedText: letterText,
          sourceType: "clinical_notes",
          status,
          learnFromEdits:
            status === "approved" &&
            Boolean(originalLetterText.trim()) &&
            originalLetterText.trim() !== letterText.trim(),
          learningSource: "clinical_scribe_letter_approval",
          praktikaPatientId: praktikaPatientId || null,
        }),
      });

      const data = await readJsonSafely(response);

      if (!response.ok || !data.success) {
        setLetterSaveStatus("error");
        alert(data.error || "Failed to save letter draft.");
        return;
      }

      const draftId = String(data.draft?.id || data.draftId || data.id || "");
      setLetterDraftId(draftId);
      setLetterSaveStatus("saved");

      setMessage(
        status === "approved"
          ? "Letter approved and moved to Approved Letters."
          : "Letter saved to provider letter drafts.",
      );
      showToast(
        status === "approved"
          ? "Letter approved."
          : "Letter draft saved.",
      );
    } catch (error) {
      console.error(error);
      setLetterSaveStatus("error");
      alert("Error saving letter draft.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl pb-24">
      {showSavedToast ? (
        <div className="fixed bottom-24 right-6 z-50 w-[22rem] max-w-[calc(100vw-3rem)] rounded-2xl border border-green-200 bg-white p-5 shadow-2xl">
          <div className="font-bold text-slate-950">Saved</div>
          <div className="mt-1 text-sm text-slate-600">{savedToastText}</div>
        </div>
      ) : null}

      <div className="grid min-h-[calc(100vh-7rem)] gap-5 lg:grid-cols-[21rem_minmax(0,1fr)]">
        <aside className="rounded-3xl border bg-white p-4 shadow-sm lg:sticky lg:top-4 lg:h-[calc(100vh-8rem)] lg:overflow-y-auto">
          <div className="mb-4 border-b pb-4">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
              AI Clinical Scribe
            </p>

            <h1 className="mt-1 text-xl font-bold text-slate-950">
              Clinical Notes
            </h1>

            <p className="mt-1 text-xs leading-5 text-slate-500">
              Record consultations, generate notes, approve, write to Praktika,
              or create letters.
            </p>

            <button
              type="button"
              onClick={resetEditor}
              className="mt-4 w-full rounded-2xl bg-slate-950 px-4 py-3 text-sm font-bold text-white hover:bg-slate-800"
            >
              + New Note
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2 rounded-2xl bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setSidebarView("drafts")}
              className={[
                "rounded-xl px-2 py-2 text-center text-xs font-bold transition",
                sidebarView === "drafts"
                  ? "bg-white text-blue-800 shadow-sm"
                  : "text-slate-600 hover:text-slate-950",
              ].join(" ")}
            >
              <span className="block">Drafts</span>
              <span className="mt-0.5 block text-[11px] font-semibold">
                {draftSessions.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setSidebarView("approved")}
              className={[
                "rounded-xl px-2 py-2 text-center text-xs font-bold transition",
                sidebarView === "approved"
                  ? "bg-white text-green-800 shadow-sm"
                  : "text-slate-600 hover:text-slate-950",
              ].join(" ")}
            >
              <span className="block">Approved</span>
              <span className="mt-0.5 block text-[11px] font-semibold">
                {approvedSessions.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setSidebarView("uploaded")}
              className={[
                "rounded-xl px-2 py-2 text-center text-xs font-bold transition",
                sidebarView === "uploaded"
                  ? "bg-white text-purple-800 shadow-sm"
                  : "text-slate-600 hover:text-slate-950",
              ].join(" ")}
            >
              <span className="block">Written</span>
              <span className="mt-0.5 block text-[11px] font-semibold">
                {uploadedSessions.length}
              </span>
            </button>
          </div>

          <div className="mt-4 flex items-center justify-between gap-3">
            <input
              className="min-w-0 flex-1 rounded-xl border p-2 text-xs"
              placeholder="Search notes..."
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
            />

            <button
              type="button"
              onClick={loadSessions}
              disabled={working}
              className="rounded-xl border px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
            >
              Refresh
            </button>
          </div>

          <div className="mt-3 space-y-2">
            {visibleSessions.map((session) => {
              const selected = selectedSession?.id === session.id;

              return (
                <div
                  key={session.id}
                  className={[
                    "group flex items-start gap-2 rounded-2xl border p-2",
                    selected
                      ? "border-blue-500 bg-blue-50"
                      : "border-slate-200 bg-white",
                  ].join(" ")}
                >
                  <button
                    type="button"
                    onClick={() => loadSessionIntoEditor(session)}
                    className="min-w-0 flex-1 rounded-xl p-1 text-left text-sm hover:bg-white/60"
                  >
                    <div className="truncate font-semibold text-slate-950">
                      {session.patient_first_name} {session.patient_last_name}
                    </div>

                    <div className="mt-1 truncate text-xs text-slate-500">
                      {formatAppointmentType(session.appointment_type)}
                    </div>

                    <div className="mt-1 text-[11px] text-slate-400">
                      {formatDateTime(session.updated_at)}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => deleteSession(session)}
                    disabled={working}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-red-500 transition hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                  >
                    <TrashBinIcon />
                  </button>
                </div>
              );
            })}

            {visibleSessions.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-4 text-xs text-slate-500">
                No notes in this section.
              </div>
            ) : null}
          </div>
        </aside>

        <main className="space-y-6">
          {message ? (
            <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
              {message}
            </div>
          ) : null}

          <section className="rounded-3xl border bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-500">
                  AI Clinical Scribe
                </p>

                <h2 className="mt-1 text-2xl font-bold text-slate-950">
                  Clinical Note
                </h2>

                <p className="mt-1 text-sm text-slate-500">
                  Match the patient, record or paste the consultation, add
                  structured data, generate, approve, write to Praktika, or
                  create a provider letter.
                </p>
              </div>

              <div className="rounded-2xl border bg-slate-50 px-5 py-3 text-right">
                <div className="text-xs font-bold uppercase tracking-wide text-slate-500">
                  Dictation timer
                </div>
                <div className="mt-1 font-mono text-2xl font-bold text-slate-950">
                  {formatDuration(recordingSeconds)}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {recording
                    ? paused
                      ? "Paused"
                      : "Recording"
                    : working
                      ? "Working"
                      : "Ready"}
                </div>
              </div>
            </div>
          </section>

          <section className="grid gap-4 rounded-3xl border bg-white p-6 shadow-sm md:grid-cols-2">
            <div>
              <label className="text-sm font-semibold text-slate-700">
                Appointment type
              </label>

              <select
                className="mt-1 w-full rounded-xl border p-3"
                value={appointmentType}
                onChange={(event) => {
                  setAppointmentType(event.target.value);
                  setStructuredData({});
                }}
              >
                {appointmentTypes.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="text-sm font-semibold text-slate-700">
                Praktika patient
              </div>

              {praktikaPatientId ? (
                <div className="mt-1 text-sm font-semibold text-green-800">
                  Matched patient selected
                  {praktikaPatientNumber
                    ? ` · Patient #: ${praktikaPatientNumber}`
                    : ""}
                </div>
              ) : (
                <div className="mt-1 text-sm text-slate-500">
                  No Praktika patient selected yet.
                </div>
              )}
            </div>

            <input
              className="rounded-xl border p-3"
              placeholder="Patient first name"
              value={patientFirstName}
              onChange={(event) => setPatientFirstName(event.target.value)}
            />

            <input
              className="rounded-xl border p-3"
              placeholder="Patient last name"
              value={patientLastName}
              onChange={(event) => setPatientLastName(event.target.value)}
            />

            <input
              className="rounded-xl border p-3"
              type="date"
              value={patientDob}
              onChange={(event) => setPatientDob(event.target.value)}
            />

            <button
              type="button"
              onClick={findPraktikaMatches}
              disabled={matching || working}
              className="rounded-xl bg-purple-700 px-5 py-3 font-semibold text-white disabled:opacity-50"
            >
              {matching ? "Searching Praktika..." : "Match Praktika Patient"}
            </button>
          </section>

          {candidates.length > 0 ? (
            <section className="rounded-3xl border border-purple-200 bg-purple-50 p-5">
              <h2 className="text-lg font-bold text-purple-950">
                Possible Praktika matches
              </h2>

              <div className="mt-3 space-y-3">
                {candidates.slice(0, 5).map((candidate, index) => {
                  const patientId = candidate.id ? String(candidate.id) : "";
                  const selected = patientId && patientId === praktikaPatientId;

                  return (
                    <div
                      key={patientId || index}
                      className="rounded-xl border border-purple-200 bg-white p-3"
                    >
                      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                        <div>
                          <div className="font-semibold text-slate-950">
                            {[candidate.firstName, candidate.lastName]
                              .filter(Boolean)
                              .join(" ") || "Unnamed patient"}
                          </div>

                          <div className="mt-1 text-xs text-slate-600">
                            Patient ID: {patientId || "-"} · Patient #:{" "}
                            {candidate.patientNumber || "-"} · DOB:{" "}
                            {candidate.dob || "-"}
                          </div>

                          <div className="mt-1 text-xs text-slate-500">
                            Score:{" "}
                            {typeof candidate.matchScore === "number"
                              ? `${Math.round(candidate.matchScore * 100)}%`
                              : "-"}{" "}
                            ·{" "}
                            {candidate.matchReason ||
                              "No match reason available."}
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => selectCandidate(candidate)}
                          disabled={!patientId}
                          className="rounded-xl bg-purple-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
                        >
                          {selected ? "Selected" : "Use this patient"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}

          <section className="rounded-3xl border bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-950">
              1. Consultation transcript
            </h2>

            <div className="mt-4 flex flex-wrap items-center gap-3">
              {!recording ? (
                <button
                  type="button"
                  onClick={startRecording}
                  disabled={working}
                  className="rounded-xl bg-green-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                >
                  Start Recording
                </button>
              ) : null}

              {recording && !paused ? (
                <button
                  type="button"
                  onClick={pauseRecording}
                  className="rounded-xl bg-amber-500 px-5 py-3 font-semibold text-white"
                >
                  Pause
                </button>
              ) : null}

              {recording && paused ? (
                <button
                  type="button"
                  onClick={resumeRecording}
                  className="rounded-xl bg-green-600 px-5 py-3 font-semibold text-white"
                >
                  Resume
                </button>
              ) : null}

              {recording ? (
                <button
                  type="button"
                  onClick={stopRecording}
                  className="rounded-xl bg-red-600 px-5 py-3 font-semibold text-white"
                >
                  Stop and Transcribe
                </button>
              ) : null}

              <div className="rounded-xl border bg-slate-50 px-4 py-3 font-mono text-lg font-bold">
                {formatDuration(recordingSeconds)}
              </div>
            </div>

            <textarea
              className="mt-4 h-56 w-full rounded-2xl border p-4 text-sm"
              placeholder="Transcript will appear here. You can also paste consultation notes manually."
              value={transcript}
              onChange={(event) => setTranscript(event.target.value)}
            />
          </section>

          <section className="rounded-3xl border bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-950">
              2. Structured clinical data
            </h2>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              {structuredFields.map((field) => {
                const wide =
                  field.input_type !== "text" ||
                  field.field_key.toLowerCase().includes("summary") ||
                  field.field_key.toLowerCase().includes("findings") ||
                  field.field_key.toLowerCase().includes("plan");

                if (field.input_type === "text") {
                  return (
                    <input
                      key={field.field_key}
                      className={[
                        "rounded-xl border p-3",
                        wide ? "md:col-span-2" : "",
                      ].join(" ")}
                      placeholder={field.placeholder || field.label}
                      value={structuredData[field.field_key] || ""}
                      onChange={(event) =>
                        updateStructuredField(
                          field.field_key,
                          event.target.value,
                        )
                      }
                    />
                  );
                }

                return (
                  <textarea
                    key={field.field_key}
                    className={[
                      "rounded-xl border p-3",
                      wide ? "md:col-span-2" : "",
                    ].join(" ")}
                    placeholder={field.placeholder || field.label}
                    value={structuredData[field.field_key] || ""}
                    onChange={(event) =>
                      updateStructuredField(field.field_key, event.target.value)
                    }
                  />
                );
              })}
            </div>
          </section>

          <section className="rounded-3xl border bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-slate-950">
              3. Generate, approve and write
            </h2>

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => saveSession("draft")}
                disabled={working}
                className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
              >
                Save Draft
              </button>

              <button
                type="button"
                onClick={generateNote}
                disabled={working}
                className="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-50"
              >
                {working ? "Working..." : "Generate Clinical Note"}
              </button>

              <button
                type="button"
                onClick={approveNote}
                disabled={working || !editedNote.trim()}
                className="rounded-xl bg-green-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
              >
                Approve Note
              </button>

              <button
                type="button"
                onClick={writeClinicalNoteToPraktika}
                disabled={working || !approved || !editedNote.trim()}
                className="rounded-xl bg-purple-700 px-5 py-3 font-semibold text-white disabled:opacity-50"
              >
                Write Clinical Note to Praktika
              </button>
            </div>

            {generatedNote || editedNote ? (
              <div className="mt-6 grid gap-4 lg:grid-cols-2">
                <div>
                  <h3 className="font-bold text-slate-950">
                    Original AI note
                  </h3>

                  <textarea
                    className="mt-2 h-96 w-full rounded-2xl border bg-slate-50 p-4 text-sm"
                    value={generatedNote}
                    readOnly
                  />
                </div>

                <div>
                  <h3 className="font-bold text-slate-950">
                    Clinician approved note
                  </h3>

                  <textarea
                    className="mt-2 h-96 w-full rounded-2xl border p-4 text-sm"
                    value={editedNote}
                    onChange={(event) => {
                      setEditedNote(event.target.value);
                      setApproved(false);
                      resetLetterPanel();
                    }}
                  />
                </div>
              </div>
            ) : null}
          </section>

          {approved ? (
            <section className="rounded-3xl border bg-white p-6 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-950">
                    4. Create letter from approved clinical note
                  </h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Generate a provider letter from this approved clinical note,
                    then save it as a provider draft or approve it for the typist
                    workflow.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setLetterPanelOpen((current) => !current)}
                  className="rounded-xl border px-4 py-3 text-sm font-semibold"
                >
                  {letterPanelOpen ? "Hide Letter Panel" : "Create Letter"}
                </button>
              </div>

              {letterPanelOpen ? (
                <div className="mt-6 space-y-5">
                  <div className="grid gap-4 md:grid-cols-2">
                    <select
                      className="rounded-xl border p-3"
                      value={reportType}
                      onChange={(event) => setReportType(event.target.value)}
                    >
                      {reportTypes.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>

                    <ReferrerSearchBox
                      onSelect={(referrer) => {
                        setReferrerName(referrer.name);
                        setReferrerAddress(formatManualReferrerAddress(referrer));
                      }}
                    />

                    <input
                      className="rounded-xl border p-3"
                      placeholder="Referrer name"
                      value={referrerName}
                      onChange={(event) => setReferrerName(event.target.value)}
                    />

                    <textarea
                      className="rounded-xl border p-3"
                      placeholder="Referrer address"
                      value={referrerAddress}
                      onChange={(event) =>
                        setReferrerAddress(event.target.value)
                      }
                    />

                    <textarea
                      className="rounded-xl border border-amber-300 bg-amber-50 p-3 md:col-span-2"
                      placeholder="Typist instructions, e.g. attach PA, attach perio chart, cc another provider..."
                      value={typistInstructions}
                      onChange={(event) =>
                        setTypistInstructions(event.target.value)
                      }
                    />
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={generateLetterFromApprovedNote}
                      disabled={working}
                      className="rounded-xl bg-slate-950 px-5 py-3 font-semibold text-white disabled:opacity-50"
                    >
                      Generate Letter
                    </button>

                    <button
                      type="button"
                      onClick={() => saveLetterDraft("draft")}
                      disabled={working || !letterText.trim()}
                      className="rounded-xl bg-blue-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                    >
                      Save Letter Draft
                    </button>

                    <button
                      type="button"
                      onClick={() => saveLetterDraft("approved")}
                      disabled={working || !letterText.trim()}
                      className="rounded-xl bg-green-600 px-5 py-3 font-semibold text-white disabled:opacity-50"
                    >
                      Approve Letter
                    </button>

                    {letterSaveStatus !== "idle" ? (
                      <div className="rounded-xl border bg-slate-50 px-4 py-3 text-sm text-slate-600">
                        {letterSaveStatus === "saving"
                          ? "Saving..."
                          : letterSaveStatus === "saved"
                            ? "Saved"
                            : "Save failed"}
                      </div>
                    ) : null}
                  </div>

                  <RichTextLetterEditor
                    value={letterText}
                    onChange={(value) => {
                      setLetterText(value);
                      setLetterSaveStatus("idle");
                    }}
                    placeholder="Generated letter will appear here..."
                    minHeightClassName="min-h-[32rem]"
                  />
                </div>
              ) : null}
            </section>
          ) : null}
        </main>
      </div>

      <button
        type="button"
        onClick={() => setPraktikaToolsOpen(true)}
        className="fixed bottom-5 right-5 z-40 rounded-full bg-slate-950 px-5 py-4 text-sm font-bold text-white shadow-2xl hover:bg-slate-800"
      >
        Praktika tools
      </button>

      <PraktikaToolsPopup
        open={praktikaToolsOpen}
        onOpenChange={setPraktikaToolsOpen}
        queueFromDate={queueFromDate}
        queueToDate={queueToDate}
        onQueueFromDateChange={setQueueFromDate}
        onQueueToDateChange={setQueueToDate}
        onSyncQueue={handleSyncQueue}
        onSyncReferrers={handleSyncReferrers}
        message={praktikaMessage}
      />
    </div>
  );
}