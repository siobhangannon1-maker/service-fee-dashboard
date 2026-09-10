-- All report-draft upload lookups constrain this job type. Include every status:
-- completed and failed/uncertain attempts must remain visible to duplicate guards.
-- Non-unique: existing architecture does not guarantee one historical job per draft.
create index if not exists praktika_upload_report_draft_idx
  on public.praktika_helper_jobs ((request->>'reportDraftId'))
  where job_type = 'upload_report_to_praktika';
