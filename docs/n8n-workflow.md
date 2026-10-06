# Manual workflow

Import `workflows/job-tracker-main.json` into the local n8n instance. Four connected nodes handle manual discovery, public search, processing, and verification of the batch result.

The API performs parameterized database writes, deduplication before detail fetch, explicit employment/location/domain filtering, requirement parsing, evidence scoring against saved profiles and audit logging. Each job keeps its own context throughout processing. Duplicate completed jobs are skipped; `parsing_failed` and `discovered` jobs can be retried. The final node reports partial failures as errors without discarding completed jobs.

A successful run means processing completed, not that an application was sent. Review at `http://localhost:3001/review`. Approval or rejection requires an explicit user action and persists atomically. There is no timer, automatic application, email or motivation-letter generation.

The public LinkedIn source can restrict access or change HTML. Such failures are surfaced rather than replaced with mock data. The score is a deterministic evidence heuristic with visible gaps and blockers, not an LLM estimate.
