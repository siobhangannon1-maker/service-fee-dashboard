import type { DraftDetail } from './draft-contract'

export function approvedDraftFixture(overrides: Partial<DraftDetail> = {}): DraftDetail {
  return {
    id: 'synthetic-draft', provider_id: 'provider', status: 'approved',
    patient_name: 'Synthetic fixture', patient_dob: null, referrer_name: null,
    referrer_address: null, report_type: 'consultation_report', source_type: 'clinical_notes',
    source_text: null, edited_text: 'Synthetic final', ai_generated_text: 'Synthetic original',
    typist_instructions: null, typist_queries: null, clinical_notes: null, source_clinical_notes: null,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:01.000Z',
    provider_approved_at: '2026-01-01T00:00:01.000Z', has_final_text: true,
    ...overrides,
  }
}
