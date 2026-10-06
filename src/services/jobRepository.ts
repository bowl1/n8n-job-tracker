import { db } from '../db.js';
import type { RawJobData, JobStatus } from '../domain/job.js';

export async function findJobByExternalId(externalJobId: string) {
  const query = `
    SELECT *
    FROM jobs
    WHERE external_job_id = $1
    LIMIT 1
  `;

  const result = await db.query(query, [externalJobId]);
  return result.rows[0] ?? null;
}

export async function insertRawJob(job: RawJobData) {
  const query = `
    INSERT INTO jobs (
      external_job_id,
      source,
      status,
      company,
      title,
      location,
      job_url,
      description,
      posted_at,
      scraped_at,
      raw_data
    ) VALUES (
      $1, $2, 'discovered', $3, $4, $5, $6, $7, $8, NOW(), $9
    )
    ON CONFLICT (external_job_id) DO NOTHING
    RETURNING *;
  `;

  const result = await db.query(query, [
    job.externalJobId,
    job.source,
    job.company,
    job.title,
    job.location,
    job.url,
    job.description ?? null,
    job.postedAt ? new Date(job.postedAt) : null,
    JSON.stringify({
      source: job.source,
      externalJobId: job.externalJobId,
      title: job.title,
      url: job.url,
      company: job.company,
      location: job.location,
      description: job.description,
    }),
  ]);

  return result.rows[0] ?? null;
}

export async function updateJobStatus(jobId: string, status: JobStatus) {
  const query = `
    UPDATE jobs
    SET status = $2, updated_at = NOW()
    WHERE id = $1
    RETURNING *;
  `;

  const result = await db.query(query, [jobId, status]);
  return result.rows[0] ?? null;
}

export async function insertJobEvent(jobId: string, eventType: string, payload: Record<string, unknown> = {}) {
  const query = `
    INSERT INTO job_events (job_id, event_type, payload)
    VALUES ($1, $2, $3)
    RETURNING *;
  `;

  const result = await db.query(query, [jobId, eventType, JSON.stringify(payload)]);
  return result.rows[0] ?? null;
}
