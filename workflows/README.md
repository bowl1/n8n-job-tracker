# Workflows

`job-tracker-main.json` is a connected, manual-only workflow:

Manual discovery → real public search → deduplicate/filter/evaluate/persist → verify result summary.

All connection keys/targets are node names, as n8n requires. HTTP requests use JSON POST to the Compose `job-api` service. Database writes and per-job context live in the API, avoiding lossy chained HTTP responses and unbound n8n SQL substitutions.

Open `http://localhost:3001/review` for persistent human approval. Scheduling is intentionally not configured. The previous workflow is saved in `job-tracker-before-fix.json`.
