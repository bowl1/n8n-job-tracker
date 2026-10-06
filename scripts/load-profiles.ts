import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { saveCandidateProfile } from '../src/services/jobDiscoveryService.js';
import { db } from '../src/db.js';
try {
  for (const version of ['A1', 'D1', 'S1']) {
    const input = JSON.parse(await readFile(new URL(`../profiles/${version}.json`, import.meta.url), 'utf8'));
    await saveCandidateProfile(input); console.log(`Saved ${version} candidate profile`);
  }
} finally { await db.end(); }
