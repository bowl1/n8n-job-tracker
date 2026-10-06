// Manual discovery of up to 20 public search pages, processing one page at a time.
const seen = new Set<string>();
let pages = 0;
let discovered = 0;
let errors = 0;
let start = 0;
async function post(path: string, payload: unknown) {
  const response = await fetch(`http://127.0.0.1:3001${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(1800000),
  });
  const result = await response.json() as any;
  if (!response.ok) throw new Error(`API ${response.status}: ${result.error ?? 'request failed'}`);
  return result;
}
for (let page = 1; page <= 20; page++) {
  const result = await post('/api/jobs/public-search', { start, limit: 25 });
  pages++;
  start += result.items.length;
  const items = result.items.filter((item: any) => !seen.has(item.externalJobId));
  if (!items.length) break;
  for (const item of items) seen.add(item.externalJobId);
  discovered += items.length;
  const processed = await post('/api/jobs/process', { items, profileVersion: 'auto' });
  errors += processed.errors;
  console.log(JSON.stringify({ page, discovered: items.length, errors: processed.errors, statuses: processed.results.map((item: any) => item.status) }));
}
console.log(JSON.stringify({ pages, discovered, errors, maximumPages: 20 }));
if (errors) process.exitCode = 1;
