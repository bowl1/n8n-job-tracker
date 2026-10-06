import { assessCandidateFit, fitStatus } from './candidateFitAssessment.js';
import { assessJobRequirements } from './jobRequirementAssessment.js';
import type { PoolClient } from 'pg';
import { db } from '../db.js';
import type { CandidateProfile, RawJobData } from '../domain/job.js';
import { fetchPublicJobDetail } from '../crawler/publicJobCrawler.js';
import { absoluteExclusions, evaluateFit, loadCandidateProfile, normalizeRawJob, parseJobDescription } from './jobDiscoveryService.js';

export async function getJob(id: string) {
  const result = await db.query('SELECT * FROM jobs WHERE id=$1', [id]);
  return result.rows[0] ?? null;
}
export async function listJobs() {
  return (await db.query("SELECT * FROM jobs WHERE status <> 'filtered_out' ORDER BY created_at DESC LIMIT 200")).rows.filter(job => absoluteExclusions(job).length === 0);
}
export function reviewCardFor(job: Record<string, any>) {
  return { id: job.id, title: job.title, company: job.company, fitScore: job.fit_score, strongMatches: job.strong_matches,
    mainGaps: job.main_gaps, hardBlockers: job.hard_blockers, recommendedCv: job.recommended_cv, jobUrl: job.job_url,
    suitability:job.fit_analysis?.suitability ?? null,fitSummary:job.fit_analysis?.summary ?? null,inferredLevel:job.fit_analysis?.inferredLevel ?? null,
    status: job.status, filterReasons: job.filter_reasons, reviewUrl: `http://localhost:3001/review/${job.id}` };
}
async function saveEvent(client: PoolClient, id: string, type: string, payload: unknown) {
  await client.query('INSERT INTO job_events(job_id,event_type,payload) VALUES ($1,$2,$3)', [id, type, JSON.stringify(payload)]);
}
export async function processJob(input: RawJobData, profile: CandidateProfile, detail = fetchPublicJobDetail, candidateProfiles: CandidateProfile[] = [profile]) {
  const raw = normalizeRawJob(input);
  const client = await db.connect();
  const key = `job-${raw.externalJobId}`;
  let locked = false;
  let jobId: string | undefined;
  try {
    locked = (await client.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked', [key])).rows[0].locked;
    if (!locked) return { externalJobId: raw.externalJobId, status: 'in_progress' };
    const existing = (await client.query('SELECT * FROM jobs WHERE external_job_id=$1', [raw.externalJobId])).rows[0];
    if (existing && !['discovered', 'parsing_failed'].includes(existing.status)) return { ...reviewCardFor(existing), duplicate: true };
    const inserted = await client.query(`INSERT INTO jobs(external_job_id,source,company,title,location,job_url,posted_at,raw_data)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(external_job_id) DO NOTHING RETURNING id`,
      [raw.externalJobId, raw.source, raw.company, raw.title, raw.location, raw.url, raw.postedAt ?? null, JSON.stringify(raw)]);
    jobId = existing?.id ?? inserted.rows[0].id;
    // This write commits before any external detail fetch, parsing or evaluation.
    const job = raw.description ? raw : await detail(raw);
    await client.query('UPDATE jobs SET description=$2,raw_data=$3,updated_at=NOW() WHERE id=$1', [jobId,job.description,JSON.stringify(job)]);
    const { filter,analysis } = await assessJobRequirements(job,existing?.requirement_analysis);
    await client.query('BEGIN');
    await client.query(`UPDATE jobs SET description=$2,raw_data=$3,scraped_at=NOW(),filter_reasons=$4,requirement_analysis=$5,updated_at=NOW() WHERE id=$1`,
      [jobId, job.description, JSON.stringify(job), JSON.stringify(filter.reasons),JSON.stringify(analysis)]);
    if (!filter.passes) {
      await client.query("UPDATE jobs SET status='filtered_out' WHERE id=$1", [jobId]);
      await saveEvent(client, jobId!, 'filtered_out', { ...filter,analysis });
    } else {
      const parsed = parseJobDescription(job.description ?? '',job.title);
      if (analysis) { parsed.minimumYears=analysis.experience.minimumYears ?? undefined; parsed.yearsOfExperience=parsed.minimumYears===undefined ? undefined : `${parsed.minimumYears}+ years`; }
      const assessment = analysis ? await assessCandidateFit(job,candidateProfiles,existing?.fit_analysis) : {fit:evaluateFit(parsed,profile),analysis:null};
      const fit = assessment.fit;
      const status = fitStatus(fit,assessment.analysis);
      const finalReasons = [...filter.reasons,...absoluteExclusions({...job,fitScore:fit.fitScore})];
      await client.query('UPDATE jobs SET filter_reasons=$2 WHERE id=$1',[jobId,JSON.stringify(finalReasons)]);
      await client.query(`UPDATE jobs SET status=$2,parsed_data=$3,fit_score=$4,fit_recommendation=$5,seniority_match=$6,
        hard_blockers=$7,strong_matches=$8,main_gaps=$9,recommended_cv=$10,fit_analysis=$11,updated_at=NOW() WHERE id=$1`,
        [jobId, status, JSON.stringify(parsed), fit.fitScore, fit.recommendation, fit.seniorityMatch,
          JSON.stringify(fit.hardBlockers), JSON.stringify(fit.strongMatches), JSON.stringify(fit.gaps), fit.recommendedCv,JSON.stringify(assessment.analysis)]);
      await saveEvent(client, jobId!, 'evaluated', { parsed, fit, analysis, fitAnalysis:assessment.analysis, filterReasons:finalReasons, profileVersion: profile.profileVersion });
    }
    await client.query('COMMIT');
    return reviewCardFor((await client.query('SELECT * FROM jobs WHERE id=$1', [jobId])).rows[0]);
  } catch (e) {
    await client.query('ROLLBACK');
    if (jobId) {
      await client.query("UPDATE jobs SET status='parsing_failed',updated_at=NOW() WHERE id=$1", [jobId]);
      await saveEvent(client, jobId, 'processing_failed', { message: e instanceof Error ? e.message : String(e) });
    }
    throw e;
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(hashtext($1))', [key]);
    client.release();
  }
}
export async function processJobBatch(items: RawJobData[], version: 'auto' | 'A1' | 'D1' | 'S1' = 'auto') {
  const profiles = new Map<string, CandidateProfile>();
  for (const v of (version === 'auto' ? ['A1', 'D1', 'S1'] : [version]) as ('A1' | 'D1' | 'S1')[]) {
    const profile = await loadCandidateProfile(v);
    if (profile) profiles.set(v, profile);
  }
  if (!profiles.size) throw new Error('Candidate profile missing. Configure it at http://localhost:3001/profile');
  const results: Record<string, any>[] = [];
  for (const item of items) {
    const preferred = /\bai\b|\bml\b|machine learning|\bllm\b/i.test(item.title) ? 'A1' : /data|analytics/i.test(item.title) ? 'D1' : 'S1';
    const profile = profiles.get(version === 'auto' ? preferred : version) ?? profiles.values().next().value!;
    try { results.push(await processJob(item, profile,fetchPublicJobDetail,[...profiles.values()])); }
    catch (e) { results.push({ externalJobId: item.externalJobId, status: 'error', error: e instanceof Error ? e.message : String(e) }); }
  }
  return { results, total: results.length, errors: results.filter(r => r.status === 'error').length,
    reviewUrl: 'http://localhost:3001/review' };
}
export async function reviewDecision(id: string, decision: 'approve' | 'skip', selectedCv: 'A1' | 'D1' | 'S1') {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const job = (await client.query('SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!job) throw new Error('Job not found');
    if (!['needs_human_review', 'low_priority', 'not_recommended'].includes(job.status)) throw new Error('Job is no longer awaiting a review decision');
    if (!(await client.query('SELECT 1 FROM candidate_profiles WHERE profile_version=$1 AND profile_data IS NOT NULL', [selectedCv])).rowCount) throw new Error('Selected CV profile is missing');
    const saved = (await client.query(`UPDATE jobs SET status=$2::job_status,selected_cv=$3,reviewed_at=NOW(),
      approved_at=CASE WHEN $2::job_status='approved_to_apply'::job_status THEN NOW() ELSE NULL END,updated_at=NOW() WHERE id=$1 RETURNING *`,
      [id, decision === 'approve' ? 'approved_to_apply' : 'skipped', selectedCv])).rows[0];
    await saveEvent(client, id, 'human_review_decision', { decision, selectedCv });
    await client.query('COMMIT'); return reviewCardFor(saved);
  } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
}
