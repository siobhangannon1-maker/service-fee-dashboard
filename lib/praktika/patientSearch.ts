import "server-only";

import { praktikaHelperPostForCurrentUser } from "@/lib/praktika/helper-job-client";

const PRAKTIKA_PRACTICE_ID = process.env.PRAKTIKA_PRACTICE_ID || "1181";

export type PraktikaPatientSearchInput = {
  firstName?: string;
  lastName?: string;
  dob?: string;
  mobile?: string;
};

export type PraktikaPatientSearchResult = {
  id: number;
  title: string | null;
  firstName: string;
  lastName: string;
  preferredName: string;
  dob: string | null;
  homePhone: string | null;
  mobile: string | null;
  statusId: number;
  dateJoined: string | null;
  patientNumber: number | null;
  isNewPatient: boolean;
  isBadPatient: boolean;
  hasHighMedicalAlert: boolean;
  practiceId: number;
  matchScore: number;
  matchReason: string;
};

function normaliseText(value: string | null | undefined) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalisePhone(value: string | null | undefined) {
  return String(value || "").replace(/\D+/g, "");
}

function normaliseDob(value: string | null | undefined) {
  const raw = String(value || "").trim();

  if (!raw) return "";

  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    return `${iso[3].padStart(2, "0")}/${iso[2].padStart(2, "0")}/${iso[1]}`;
  }

  const au = raw.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/);
  if (au) {
    const day = au[1].padStart(2, "0");
    const month = au[2].padStart(2, "0");
    let year = au[3];

    if (year.length === 2) {
      const numericYear = Number(year);
      year = numericYear <= 29 ? `20${year}` : `19${year}`;
    }

    return `${day}/${month}/${year}`;
  }

  return raw.replace(/-/g, "/");
}

function makeTextFilter(
  field: string,
  value: string,
  type: "startsWith" | "contains",
) {
  return {
    [field]: {
      filterType: "upperText",
      type,
      filter: value,
    },
  };
}

function buildSearchAttempts(input: PraktikaPatientSearchInput) {
  const attempts: Array<{ label: string; filterModel: Record<string, any> }> =
    [];

  const firstName = input.firstName?.trim();
  const lastName = input.lastName?.trim();
  const mobile = normalisePhone(input.mobile);

  if (lastName) {
    attempts.push({
      label: "lastName startsWith",
      filterModel: makeTextFilter("lastName", lastName, "startsWith"),
    });

    attempts.push({
      label: "lastName contains",
      filterModel: makeTextFilter("lastName", lastName, "contains"),
    });
  }

  if (firstName) {
    attempts.push({
      label: "firstName startsWith",
      filterModel: makeTextFilter("firstName", firstName, "startsWith"),
    });

    attempts.push({
      label: "firstName contains",
      filterModel: makeTextFilter("firstName", firstName, "contains"),
    });
  }

  if (firstName && lastName) {
    attempts.push({
      label: "firstName + lastName contains",
      filterModel: {
        ...makeTextFilter("firstName", firstName, "contains"),
        ...makeTextFilter("lastName", lastName, "contains"),
      },
    });
  }

  if (mobile) {
    attempts.push({
      label: "mobile contains",
      filterModel: makeTextFilter("mobile", mobile, "contains"),
    });

    if (mobile.startsWith("61") && mobile.length > 2) {
      attempts.push({
        label: "mobile without country code contains",
        filterModel: makeTextFilter("mobile", `0${mobile.slice(2)}`, "contains"),
      });
    }

    if (mobile.startsWith("0") && mobile.length > 1) {
      attempts.push({
        label: "mobile country code contains",
        filterModel: makeTextFilter("mobile", `61${mobile.slice(1)}`, "contains"),
      });
    }

    if (mobile.length >= 8) {
      attempts.push({
        label: "mobile last 8 contains",
        filterModel: makeTextFilter("mobile", mobile.slice(-8), "contains"),
      });
    }
  }

  if (attempts.length === 0) {
    attempts.push({
      label: "empty fallback",
      filterModel: {},
    });
  }

  return attempts;
}

function scorePatientMatch(patient: any, input: PraktikaPatientSearchInput) {
  let score = 0;
  const reasons: string[] = [];

  const inputFirst = normaliseText(input.firstName);
  const inputLast = normaliseText(input.lastName);
  const inputDob = normaliseDob(input.dob);
  const inputMobile = normalisePhone(input.mobile);

  const patientFirst = normaliseText(patient.firstName);
  const patientLast = normaliseText(patient.lastName);
  const patientPreferred = normaliseText(patient.preferredName);
  const patientDob = normaliseDob(patient.dob);
  const patientMobile = normalisePhone(patient.mobile || patient.homePhone);

  if (inputFirst && patientFirst && inputFirst === patientFirst) {
    score += 0.25;
    reasons.push("first name matched");
  } else if (inputFirst && patientPreferred && inputFirst === patientPreferred) {
    score += 0.25;
    reasons.push("preferred name matched");
  } else if (
    inputFirst &&
    patientFirst &&
    (patientFirst.includes(inputFirst) || inputFirst.includes(patientFirst))
  ) {
    score += 0.12;
    reasons.push("first name partial match");
  }

  if (inputLast && patientLast && inputLast === patientLast) {
    score += 0.35;
    reasons.push("last name matched");
  } else if (
    inputLast &&
    patientLast &&
    (patientLast.includes(inputLast) || inputLast.includes(patientLast))
  ) {
    score += 0.18;
    reasons.push("last name partial match");
  }

  if (
    inputFirst &&
    inputLast &&
    patientFirst &&
    patientLast &&
    inputFirst === patientFirst &&
    inputLast === patientLast
  ) {
    score += 0.15;
    reasons.push("exact full name matched");
  }

  if (inputDob && patientDob && inputDob === patientDob) {
    score += 0.45;
    reasons.push("DOB matched");
  }

  if (inputMobile && patientMobile && inputMobile === patientMobile) {
    score += 0.35;
    reasons.push("mobile matched");
  } else if (
    inputMobile &&
    patientMobile &&
    inputMobile.length >= 8 &&
    patientMobile.length >= 8 &&
    (patientMobile.endsWith(inputMobile.slice(-8)) ||
      inputMobile.endsWith(patientMobile.slice(-8)))
  ) {
    score += 0.2;
    reasons.push("mobile partial match");
  }

  return {
    score: Math.min(score, 1),
    reason: reasons.length ? reasons.join(", ") : "Returned by Praktika search.",
  };
}

async function searchAttempt({
  input,
  filterModel,
  attemptLabel,
}: {
  input: PraktikaPatientSearchInput;
  filterModel: Record<string, any>;
  attemptLabel: string;
}) {
  const json = await praktikaHelperPostForCurrentUser<any>({
    jobType: "patient_match_search",
    priority: 15,
    path: "/php/json/db_gridPatientList.php",
    contentType: "json",
    referer: "https://praktika.praktika.net.au/v2/patients",
    timeoutMs: 90_000,
    body: {
      startRow: 0,
      endRow: 100,
      rowGroupCols: [],
      valueCols: [],
      pivotCols: [],
      pivotMode: false,
      groupKeys: [],
      filterModel,
      practiceIds: [Number(PRAKTIKA_PRACTICE_ID)],
      searchMode: "AND",
      sortModel: [
        { sort: "asc", colId: "lastName", caseSensitive: false },
        { sort: "asc", colId: "firstName", caseSensitive: false },
      ],
      docudentalAttemptLabel: attemptLabel,
    },
  });

  const rows = Array.isArray(json?.rows) ? json.rows : [];

  return rows.map((patient: any) => {
    const scored = scorePatientMatch(patient, input);

    return {
      id: Number(patient.id),
      title: patient.title || null,
      firstName: patient.firstName || "",
      lastName: patient.lastName || "",
      preferredName: patient.preferredName || "",
      dob: patient.dob || null,
      homePhone: patient.homePhone || null,
      mobile: patient.mobile || null,
      statusId: Number(patient.statusId || 0),
      dateJoined: patient.dateJoined || null,
      patientNumber: patient.patientNumber ? Number(patient.patientNumber) : null,
      isNewPatient: Boolean(patient.isNewPatient),
      isBadPatient: Boolean(patient.isBadPatient),
      hasHighMedicalAlert: Boolean(patient.hasHighMedicalAlert),
      practiceId: Number(patient.practiceId || PRAKTIKA_PRACTICE_ID),
      matchScore: scored.score,
      matchReason: scored.reason,
    } satisfies PraktikaPatientSearchResult;
  });
}

async function searchOnce(input: PraktikaPatientSearchInput) {
  const attempts = buildSearchAttempts(input);
  const allResults: PraktikaPatientSearchResult[] = [];
  const seen = new Set<number>();

  for (const attempt of attempts) {
    const results = await searchAttempt({
      input,
      filterModel: attempt.filterModel,
      attemptLabel: attempt.label,
    });

    for (const result of results) {
      if (seen.has(result.id)) continue;

      seen.add(result.id);
      allResults.push(result);
    }

    if (allResults.some((result) => result.matchScore >= 0.8)) {
      break;
    }
  }

  return allResults.sort((a, b) => b.matchScore - a.matchScore);
}

export async function searchPraktikaPatients(
  input: PraktikaPatientSearchInput,
): Promise<PraktikaPatientSearchResult[]> {
  if (
    !input.firstName?.trim() &&
    !input.lastName?.trim() &&
    !input.dob?.trim() &&
    !input.mobile?.trim()
  ) {
    throw new Error("Enter at least one search field.");
  }

  return await searchOnce(input);
}
