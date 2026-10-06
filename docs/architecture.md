# Application architecture

Three local Compose services run n8n, the TypeScript API and PostgreSQL. PostgreSQL stores jobs, structured candidate profiles, parsed descriptions, fit results, review decisions and audit events. n8n contains a manual trigger, real public search, batch processing and result verification. No scheduler is configured.

## Lifecycle

```text
discovered -> filtered_out | parsing_failed | needs_human_review | low_priority | not_recommended
parsing_failed -> retry discovery/detail processing
needs_human_review | low_priority | not_recommended -> approved_to_apply | skipped
```

The raw search record commits before detail requests. A session advisory lock prevents simultaneous processing of the same external id. Completed records are skipped before fetching details; incomplete records are retryable. Description, parsed output, fit results and the evaluated event commit in one transaction. All SQL uses bound parameters.

## Evidence processing

The public crawler parses LinkedIn guest search/detail HTML, without authentication or bypasses. Requests are serialized and spaced by at least 1.5 seconds. Rate/server failures respect Retry-After with one retry when the wait is bounded; extended cooldowns are surfaced to the caller. Source failures are never replaced with example jobs.

The rule filter handles Denmark location, software/data/AI scope and explicit part-time employment. Senior roles, student jobs/current-enrollment requirements and explicit experience requirements of at least 3 years are also hard exclusions. Unknown full-time status is flagged. A deterministic parser extracts recognizable skills, languages and experience requirements; optional language/skill statements are separated where recognized. The evaluator scores only declared candidate evidence and flags insufficient evidence, professional experience shortages and required language mismatches. Skill scoring is a heuristic. Optional OpenAI-compatible LLM assessment replaces semantic keyword decisions for Senior roles, student requirements and mandatory experience, with JSON schema validation and exact source quotes. When enabled, provider failures are reported rather than silently falling back. Results are cached by input/model/prompt hash and saved in requirement_analysis.

A1, D1 and S1 contain the user's supplied AI, Data and Software CV profiles. No fictitious employer, years of experience or work authorization is used. Updating a profile does not alter past approvals: `npm run jobs:reevaluate` refreshes only unreviewed records.

## Human decisions

The local `/review` UI shows matches, gaps, blockers, filter reasons and the full source description. Each approve/skip action includes a CSRF token and selected CV. The API locks the job row, rejects repeated decisions and atomically writes status, selected CV, timestamps and an audit event. Ports bind to localhost and browser writes require the same origin.

Approval ends at `approved_to_apply`. No external application is submitted. Motivation-letter generation, email composition and scheduled execution are not configured.

## Candidate fit stage

When LLM_FIT_ENABLED is enabled, every job passing the requirement filter receives a second LLM assessment using merged evidence from all candidate CV variants. The model infers unstated rank from responsibilities, evaluates professional experience separately from projects/academic work, and saves suitability, confidence, score, reasons and grounded JD/candidate quotes. Contact/name/link fields are excluded. Fit data lives in jobs.fit_analysis; cache identity includes all supplied profile evidence. No application or human decision is automatic.
