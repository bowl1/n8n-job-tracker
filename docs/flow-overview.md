# Current manual job workflow

1. In n8n, click **Execute Workflow** on **Job Tracker Main Flow**.
2. Fetch real public LinkedIn job cards for the configured keywords, location and page.
3. Skip completed duplicates, acquire a per-job lock and commit the raw search record.
4. Fetch the public JD and employment type. Persist failures so a subsequent run can retry.
5. Filter explicit location/domain/employment mismatches, Senior roles, student jobs and explicit requirements of at least 3 years of experience. Flag unknown full-time status.
6. Parse requirements and compare them with real saved candidate evidence. Select A1 for AI titles, D1 for Data titles or S1 for other software titles, with human override.
7. Save parsed data, score, reasons, blockers, matches, gaps and an audit event in PostgreSQL. The final n8n node reports any partial failures visibly.
8. Visit `http://localhost:3001/review`, inspect the original JD, select a CV and choose approve or skip.
9. Save the human decision atomically, including selected CV and timestamps. Approval records `approved_to_apply`; it does not submit an application.

Scoring uses a transparent keyword/evidence heuristic, so the human must verify requirements that it cannot interpret. Candidate profile editing is at `http://localhost:3001/profile`. Scheduling, letter generation and email actions are not part of this implementation.
