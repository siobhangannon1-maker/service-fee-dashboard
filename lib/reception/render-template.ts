// src/lib/reception/render-template.ts

export type TemplateMacroContext = {
  patient?: {
    first_name?: string | null;
    last_name?: string | null;
    preferred_name?: string | null;
    full_name?: string | null;
    mobile?: string | null;
    email?: string | null;
    dob?: string | null;
    patient_number?: string | null;
  };
  appointment?: {
    id?: string | null;
    date?: string | null;
    day?: string | null;
    time?: string | null;
    datetime?: string | null;
    type?: string | null;
    label?: string | null;
    provider?: string | null;
    resource?: string | null;
    location?: string | null;
  };
  next_appointment?: {
    id?: string | null;
    date?: string | null;
    day?: string | null;
    time?: string | null;
    datetime?: string | null;
    type?: string | null;
    label?: string | null;
    provider?: string | null;
    location?: string | null;
  };
  practice?: {
    name?: string | null;
    phone?: string | null;
  };
  staff?: {
    first_name?: string | null;
    full_name?: string | null;
  };
  questionnaire?: {
    link?: string | null;
  };
};

export const AVAILABLE_TEMPLATE_MACROS = [
  "{{patient.first_name}}",
  "{{patient.last_name}}",
  "{{patient.preferred_name}}",
  "{{patient.full_name}}",
  "{{patient.mobile}}",
  "{{patient.email}}",
  "{{patient.dob}}",
  "{{patient.patient_number}}",

  "{{appointment.id}}",
  "{{appointment.date}}",
  "{{appointment.day}}",
  "{{appointment.time}}",
  "{{appointment.datetime}}",
  "{{appointment.type}}",
  "{{appointment.label}}",
  "{{appointment.provider}}",
  "{{appointment.resource}}",
  "{{appointment.location}}",

  "{{next_appointment.id}}",
  "{{next_appointment.date}}",
  "{{next_appointment.day}}",
  "{{next_appointment.time}}",
  "{{next_appointment.datetime}}",
  "{{next_appointment.type}}",
  "{{next_appointment.label}}",
  "{{next_appointment.provider}}",
  "{{next_appointment.location}}",

  "{{practice.name}}",
  "{{practice.phone}}",

  "{{staff.first_name}}",
  "{{staff.full_name}}",

  "{{questionnaire.link}}",
];

function getNestedValue(context: TemplateMacroContext, path: string): string {
  const parts = path.split(".");
  let current: any = context;

  for (const part of parts) {
    if (current == null) return "";
    current = current[part];
  }

  return current == null ? "" : String(current);
}

export function renderTemplate(
  templateBody: string,
  context: TemplateMacroContext
) {
  return templateBody.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (_, path) => {
    return getNestedValue(context, path);
  });
}

export function findMissingMacros(
  templateBody: string,
  context: TemplateMacroContext
) {
  const missing: string[] = [];
  const matches = templateBody.matchAll(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g);

  for (const match of matches) {
    const path = match[1];
    const value = getNestedValue(context, path);

    if (!value) {
      missing.push(`{{${path}}}`);
    }
  }

  return [...new Set(missing)];
}

export function smsSegmentCount(message: string) {
  if (!message) return 0;
  return Math.ceil(message.length / 160);
}