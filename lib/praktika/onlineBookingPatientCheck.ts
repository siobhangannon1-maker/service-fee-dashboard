const BASE_URL =
  process.env.PRAKTIKA_BASE_URL || "https://appointments.praktika.net.au";

const API_KEY = process.env.PRAKTIKA_API_KEY || "";
const AUTH_KEY = process.env.PRAKTIKA_AUTH_KEY || "";

const BASE_API = `${BASE_URL}/php/onlineBookingV2`;

const DEFAULT_PRACTICE_ID = "3434376";
const DEFAULT_STAFF_ID = "7275352";
const DEFAULT_APPOINTMENT_TYPE_ID = "5058702";

type PatientCheckInput = {
  firstName: string;
  lastName: string;
  dob: string;
  mobile?: string;
  email?: string;
};

type PraktikaSlot = {
  practiceId: string;
  resourceId: string;
  staffId: string;
  appointmentTypeId: string;
  startDate: string;
  endDate: string;
};

function requiredEnv() {
  if (!API_KEY) {
    throw new Error("Missing PRAKTIKA_API_KEY.");
  }

  if (!AUTH_KEY) {
    throw new Error("Missing PRAKTIKA_AUTH_KEY.");
  }
}

function normaliseMobile(value: string | undefined) {
  return String(value || "").replace(/\s+/g, "");
}

function addAuth(form: FormData) {
  form.append("apikey", API_KEY);
  form.append("authkey", AUTH_KEY);
}

async function postForm(endpoint: string, form: FormData) {
  const response = await fetch(`${BASE_API}/${endpoint}`, {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
    },
    body: form,
    cache: "no-store",
  });

  const text = await response.text();

  let json: any = null;

  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  if (!response.ok) {
    throw new Error(
      `Praktika request failed ${response.status}: ${text.slice(0, 500)}`,
    );
  }

  return {
    status: response.status,
    text,
    json,
  };
}

export async function findFirstAvailablePraktikaSlot() {
  requiredEnv();

  const today = new Date();
  const startDate = today.toISOString().slice(0, 10);

  const end = new Date();
  end.setDate(end.getDate() + 21);
  const endDate = end.toISOString().slice(0, 10);

  const form = new FormData();
  addAuth(form);

  form.append("practice_id", DEFAULT_PRACTICE_ID);
  form.append("staff_id", DEFAULT_STAFF_ID);
  form.append("appointment_type_id", DEFAULT_APPOINTMENT_TYPE_ID);
  form.append("start_date", startDate);
  form.append("end_date", endDate);

  const result = await postForm("db_search.php", form);

  const availability = result.json || {};

  for (const dateKey of Object.keys(availability)) {
    const byStaff = availability[dateKey];

    if (!byStaff || typeof byStaff !== "object") continue;

    for (const staffId of Object.keys(byStaff)) {
      const slots = byStaff[staffId];

      if (Array.isArray(slots) && slots.length > 0) {
        return slots[0] as PraktikaSlot;
      }
    }
  }

  throw new Error("No Praktika appointment slot found for patient check.");
}

export async function checkOnlineBookingPatientStatus(
  input: PatientCheckInput,
) {
  requiredEnv();

  if (!input.firstName || !input.lastName || !input.dob) {
    throw new Error("firstName, lastName and dob are required.");
  }

  const slot = await findFirstAvailablePraktikaSlot();

  const form = new FormData();
  addAuth(form);

  const mobile = normaliseMobile(input.mobile);
  const email = input.email || "";

  form.append("submitter", "patient");
  form.append("submitter_firstname", input.firstName);
  form.append("submitter_lastname", input.lastName);
  form.append("submitter_mobile", mobile || "-");
  form.append("submitter_email", email || "-");
  form.append("submitter_relationship", "-");
  form.append("submitter_relationship_other", "-");
  form.append("submitter_contact", "-");

  form.append("patient_seen_before", "no");
  form.append("patient_title", "");
  form.append("patient_firstname", input.firstName);
  form.append("patient_lastname", input.lastName);
  form.append("patient_dob", input.dob);
  form.append("patient_mobile", mobile);
  form.append("patient_email", email);
  form.append("patient_address_street", "");
  form.append("patient_address_suburb", "");
  form.append("patient_address_postcode", "");
  form.append("patient_address_state", "");
  form.append("patient_address", "");
  form.append("patient_healthfund", "-");
  form.append("patient_notes", "");

  form.append("appointment_type_id", slot.appointmentTypeId);
  form.append("practice_id", slot.practiceId);
  form.append("resource_id", slot.resourceId);
  form.append("staff_id", slot.staffId);
  form.append("start_date", slot.startDate);
  form.append("end_date", slot.endDate);

  const result = await postForm("db_register.php", form);

  const response = result.json || {};

  return {
    success: true,
    isExistingPatient: response.isNewPatient === "f",
    isNewPatient: response.isNewPatient === "t",
    rawIsNewPatient: response.isNewPatient ?? null,
    requestId: response.requestId ?? null,
    statusId: response.statusId ?? null,
    depositAmount: response.depositAmount ?? null,
    slot,
    response,
  };
}