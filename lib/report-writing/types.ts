export type ReportType =
  | "consultation_report"
  | "treatment_report"
  | "review"
  | "SPT_report"
  | "osseointegration_letter"
  | "surgery_report"

export interface GenerateReportInput {
  patientName: string
  patientDob: string
  referrerName: string
  reportType: ReportType
  clinicalNotes: string
}