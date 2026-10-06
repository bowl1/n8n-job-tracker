import { db } from '../src/db.js';
const rows = (await db.query("SELECT raw_data FROM jobs WHERE status='parsing_failed' ORDER BY created_at")).rows;
for (const row of rows) {
  const response = await fetch('http://127.0.0.1:3001/api/jobs/process', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: [row.raw_data], profileVersion: 'auto' }),
    signal: AbortSignal.timeout(1800000),
  });
  const result = await response.json() as any;
  console.log(JSON.stringify({ title: row.raw_data.title, status: result.results?.[0]?.status, error: result.results?.[0]?.error ?? result.error }));
}
await db.end();
