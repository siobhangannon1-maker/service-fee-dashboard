import { GenerateReportInput } from "./types"

export function buildReportPrompt(
  data: GenerateReportInput
) {
  return `
You are a specialist dental report writing assistant.

Write a professional specialist dental report.

REPORT TYPE:
${data.reportType}

PATIENT:
${data.patientName}

DOB:
${data.patientDob}

REFERRER:
${data.referrerName}

CLINICAL NOTES:
${data.clinicalNotes}

INSTRUCTIONS:
- Use professional dental and medical terminology
- Write clearly and concisely
- Use appropriate medical formatting
- Do not invent findings
- Do not include placeholders
- Do not use emdashes
- Output only the final report
`
}