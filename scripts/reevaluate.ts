import 'dotenv/config';
import { assessCandidateFit, fitStatus } from '../src/services/candidateFitAssessment.js';
import { assessJobRequirements } from '../src/services/jobRequirementAssessment.js';
import { db } from '../src/db.js';
import { absoluteExclusions, evaluateFit, loadCandidateProfile, parseJobDescription } from '../src/services/jobDiscoveryService.js';
// Refresh filtering and analysis only for unreviewed jobs; approvals and skips are preserved.
try {
  const jobs = (await db.query("SELECT id FROM jobs WHERE status IN ('needs_human_review','low_priority','not_recommended','filtered_out') AND description IS NOT NULL")).rows;
  const profiles = (await Promise.all((['A1','D1','S1'] as const).map(v=>loadCandidateProfile(v)))).filter((p): p is NonNullable<typeof p>=>Boolean(p));
  let count = 0;
  for (const { id } of jobs) {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const job = (await client.query('SELECT * FROM jobs WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!['needs_human_review','low_priority','not_recommended','filtered_out'].includes(job.status)) { await client.query('ROLLBACK'); continue; }
      const {filter,analysis} = await assessJobRequirements({ ...job.raw_data, title: job.title, location: job.location, description: job.description },job.requirement_analysis);
      if (!filter.passes) {
        await client.query(`UPDATE jobs SET status='filtered_out',filter_reasons=$2,fit_score=NULL,fit_recommendation=NULL,
          hard_blockers='[]',strong_matches='[]',main_gaps='[]',recommended_cv=NULL,requirement_analysis=$3,fit_analysis=NULL,updated_at=NOW() WHERE id=$1`, [id,JSON.stringify(filter.reasons),JSON.stringify(analysis)]);
        await client.query("INSERT INTO job_events(job_id,event_type,payload) VALUES ($1,'refiltered',$2)", [id,JSON.stringify({...filter,analysis})]);
        await client.query('COMMIT'); count++; continue;
      }
      const version = job.recommended_cv ?? (/\bai\b|\bml\b|machine learning|\bllm\b/i.test(job.title) ? 'A1' : /data|analytics/i.test(job.title) ? 'D1' : 'S1');
      const profile = await loadCandidateProfile(version);
      if (!profile) throw new Error('Candidate profile missing');
      const parsed = parseJobDescription(job.description,job.title);
      if (analysis) { parsed.minimumYears=analysis.experience.minimumYears ?? undefined; parsed.yearsOfExperience=parsed.minimumYears===undefined ? undefined : `${parsed.minimumYears}+ years`; }
      const assessment = analysis ? await assessCandidateFit({ ...job.raw_data,title:job.title,location:job.location,description:job.description },profiles,job.fit_analysis) : {fit:evaluateFit(parsed,profile),analysis:null};
      const fit=assessment.fit;
      const status=fitStatus(fit,assessment.analysis);
      await client.query(`UPDATE jobs SET status=$2,fit_score=$3,fit_recommendation=$4,hard_blockers=$5,strong_matches=$6,main_gaps=$7,parsed_data=$8,filter_reasons=$9,recommended_cv=$10,requirement_analysis=$11,fit_analysis=$12,updated_at=NOW() WHERE id=$1`, [id,status,fit.fitScore,fit.recommendation,JSON.stringify(fit.hardBlockers),JSON.stringify(fit.strongMatches),JSON.stringify(fit.gaps),JSON.stringify(parsed),JSON.stringify([...filter.reasons,...absoluteExclusions({fitScore:fit.fitScore})]),fit.recommendedCv,JSON.stringify(analysis),JSON.stringify(assessment.analysis)]);
      await client.query("INSERT INTO job_events(job_id,event_type,payload) VALUES ($1,'reevaluated',$2)", [id,JSON.stringify({fit,analysis,fitAnalysis:assessment.analysis,profileVersion:profile.profileVersion})]);
      await client.query('COMMIT'); count++;
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  console.log(`Re-evaluated ${count} unreviewed jobs`);
} finally { await db.end(); }
