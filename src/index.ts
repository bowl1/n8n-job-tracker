import 'dotenv/config';
import { fetchPublicJobSearch } from './crawler/publicJobCrawler.js';
import { processJobBatch } from './services/jobProcessor.js';
import { db } from './db.js';
try {
  console.log(JSON.stringify(await processJobBatch(await fetchPublicJobSearch()), null, 2));
} finally { await db.end(); }
