import { localizeUi, resolveUiLanguage, type UiLanguage } from './uiLanguage.js';
import 'dotenv/config';
import { assessCandidateFit, candidateFitStatus } from './services/candidateFitAssessment.js';
import { assessJobRequirements } from './services/jobRequirementAssessment.js';
import { llmStatus } from './services/jobRequirementAssessment.js';
import http from 'node:http';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { db, pingDatabase } from './db.js';
import { fetchPublicJobSearch } from './crawler/publicJobCrawler.js';
import { candidateProfileSchema, loadCandidateProfile, parseJobDescription, saveCandidateProfile } from './services/jobDiscoveryService.js';
import { getJob, listJobs, processJobBatch, reviewCardFor, reviewDecision } from './services/jobProcessor.js';

const PORT = Number(process.env.API_PORT ?? 3001);
const secret = randomBytes(32);
const token = (action: string) => createHmac('sha256', secret).update(action).digest('hex');
function validToken(action: string, value: unknown) {
  const supplied = Buffer.from(typeof value === 'string' ? value : '');
  const expected = Buffer.from(token(action));
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[s]!);
function reviewIntro() {
  if (!llmStatus().enabled) return 'LLM assessment is disabled. Matching uses rules and skill evidence.';
  return candidateFitStatus().enabled
    ? 'The LLM assesses every new job that passes screening against your background. When seniority is unspecified, it examines responsibilities and expected independence.'
    : 'The LLM assesses seniority, student requirements and required experience. Background matching is not enabled.';
}
function json(res: http.ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data));
}
function html(res: http.ServerResponse, content: string, language: UiLanguage, pageUrl: URL) {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'" });
  const switchUrl = (lang: UiLanguage) => {const next=new URL(pageUrl);next.searchParams.set('lang',lang);return esc(next.pathname+next.search);};
  res.end(localizeUi(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Job Tracker</title><style>body{font:16px system-ui;max-width:1000px;margin:40px auto;padding:0 20px;background:#f6f7fb;color:#172033}a{color:#225bcc}article{background:white;border:1px solid #dbe0eb;padding:24px;margin:20px 0;border-radius:12px}textarea{width:100%;height:440px}button,select{padding:10px;margin:8px}pre{white-space:pre-wrap}nav{display:flex;gap:24px}.badge{color:#596579}</style><nav><a href="/review">Job review</a><a href="/profile">Candidate profile</a><span><a href="${switchUrl('en')}" lang="en" ${language==='en' ? 'aria-current="true"' : ''}>English</a> / <a href="${switchUrl('zh')}" lang="zh" ${language==='zh' ? 'aria-current="true"' : ''}>中文</a></span></nav><p class="badge">Existing assessments and original evidence retain their saved language.</p>${content}</html>`,language));
}
async function body(req: http.IncomingMessage): Promise<any> {
  let size = 0; const parts: Buffer[] = [];
  for await (const chunk of req) { size += chunk.length; if (size > 1024 * 1024) throw new Error('Request body exceeds 1 MB'); parts.push(chunk); }
  const text = Buffer.concat(parts).toString('utf8');
  if (req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(text));
  if (text && !req.headers['content-type']?.startsWith('application/json')) throw new Error('Use application/json');
  return JSON.parse(text || '{}');
}
const searchSchema = z.object({ keywords: z.string().min(1).max(200).optional(), location: z.string().min(1).max(200).optional(), page: z.number().int().min(1).max(20).default(1), start: z.number().int().min(0).max(500).optional(), limit: z.number().int().min(1).max(25).default(25) });
const rawSchema = z.object({ externalJobId: z.string().regex(/^linkedin-\d+$/), source: z.literal('linkedin_public'), title: z.string().min(1), company: z.string().min(1), location: z.string().min(1), url: z.string().url(), postedAt: z.string().datetime().optional(), scrapedAt: z.string().datetime().optional(), description: z.string().optional(), employmentType: z.string().optional() });
const decisionSchema = z.object({ decision: z.enum(['approve', 'skip']), selectedCv: z.enum(['A1', 'D1', 'S1']), token: z.string() });

export const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host ?? '';
    if (!/^(localhost|127\.0\.0\.1|host\.docker\.internal|job-api)(:\d+)?$/.test(host)) { json(res, 403, { error: 'Untrusted host' }); return; }
    if (req.method === 'POST' && req.headers.origin && req.headers.origin !== `http://${host}`) { json(res, 403, { error: 'Cross-origin write rejected' }); return; }
    const url = new URL(req.url ?? '/', 'http://localhost');
    const language = resolveUiLanguage(url.searchParams.get('lang'),req.headers.cookie);
    if (['en','zh'].includes(url.searchParams.get('lang') ?? '')) res.setHeader('Set-Cookie',`ui_language=${language}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`);
    if (req.method === 'GET' && url.pathname === '/health') {
      const healthy = await pingDatabase(); json(res, healthy ? 200 : 503, { ok: healthy, service: 'job-tracker-local-api', llm:{...llmStatus(),candidateFitEnabled:candidateFitStatus().enabled} }); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/jobs/public-search') {
      json(res, 200, { items: await fetchPublicJobSearch(searchSchema.parse(await body(req))) }); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/jobs/process') {
      const input = z.object({ items: z.array(rawSchema).max(25), profileVersion: z.enum(['auto','A1','D1','S1']).default('auto') }).parse(await body(req));
      json(res, 200, await processJobBatch(input.items, input.profileVersion)); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/agents/parse-job') {
      const input = z.object({ jd: z.string().trim().min(1) }).parse(await body(req));
      json(res, 200, { parsedJob: parseJobDescription(input.jd) }); return;
    }
    if (req.method === 'GET' && url.pathname === '/api/profile/current') {
      const version = z.enum(['A1','D1','S1']).parse(url.searchParams.get('version') ?? 'A1');
      const profile = await loadCandidateProfile(version); json(res, profile ? 200 : 409, profile ? { profile } : { error: 'Candidate profile missing; visit /profile' }); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/agents/evaluate-fit') {
      const input = z.object({job:rawSchema,profiles:z.array(candidateProfileSchema).min(1).max(3)}).parse(await body(req));
      const requirements = await assessJobRequirements(input.job);
      if (!requirements.filter.passes) { json(res,200,{status:'filtered_out',filterReasons:requirements.filter.reasons}); return; }
      const assessment = await assessCandidateFit(input.job,input.profiles);
      json(res,200,{...assessment.fit,fitAnalysis:assessment.analysis}); return;
    }
    if (req.method === 'POST' && url.pathname === '/api/review/card') {
      const input = z.object({ jobId: z.string().uuid() }).parse(await body(req)); const job = await getJob(input.jobId);
      json(res, job ? 200 : 404, job ? { reviewCard: reviewCardFor(job) } : { error: 'Job not found' }); return;
    }
    const match = url.pathname.match(/^\/(?:api\/)?review\/([0-9a-f-]{36})(?:\/decision)?$/);
    if (req.method === 'POST' && match) {
      const input = decisionSchema.parse(await body(req));
      if (!validToken(`review-${match[1]}`, input.token)) { json(res, 403, { error: 'Review token invalid; reload the review page' }); return; }
      const result = await reviewDecision(match[1], input.decision, input.selectedCv);
      if (req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) { res.writeHead(303, { Location: `/review/${match[1]}` }); res.end(); }
      else json(res, 200, result); return;
    }
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/review' || match)) {
      const jobs = match ? [await getJob(match[1])].filter(Boolean) : await listJobs();
      html(res, `<h1>Job review</h1><p>Click Approve to mark a job as approved to apply. Applications are not sent automatically. ${esc(reviewIntro())} Check the original posting for mandatory requirements.</p>${jobs.length ? jobs.map(job => {
        const pending = ['needs_human_review', 'low_priority', 'not_recommended'].includes(job.status);
        return `<article><h2 data-original="true"><a href="/review/${esc(job.id)}">${esc(job.title)}</a></h2><p data-original="true">${esc(job.company)} · ${esc(job.location)}</p><p class="badge">${esc(job.status)} · Match score ${esc(job.fit_score ?? 'Not assessed')} · Recommended CV ${esc(job.recommended_cv ?? '')}</p><p><a href="${esc(job.job_url)}" rel="noreferrer">View original posting</a></p>${job.requirement_analysis ? `<details><summary>LLM requirements assessment and evidence</summary><p>Seniority: <span data-original="true">${esc(job.requirement_analysis.senior.explanation)}</span></p><blockquote>${esc(job.requirement_analysis.senior.evidence)}</blockquote><p>Experience requirements: <span data-original="true">${esc(job.requirement_analysis.experience.explanation)}</span></p><blockquote>${esc(job.requirement_analysis.experience.evidence)}</blockquote><p>Student requirements: <span data-original="true">${esc(job.requirement_analysis.student.explanation)}</span></p><blockquote>${esc(job.requirement_analysis.student.evidence)}</blockquote></details>` : '<p>This job has not yet received an LLM requirements assessment.</p>'}${job.fit_analysis ? `<section><h3>Match against your background</h3><p>Verdict: ${esc(({suitable:'Suitable',stretch:'Stretch opportunity',unsuitable:'Unsuitable',uncertain:'Uncertain; more information needed'} as Record<string,string>)[job.fit_analysis.suitability])} · Confidence: ${esc(({high:'High',medium:'Medium',low:'Low'} as Record<string,string>)[job.fit_analysis.confidence])}</p><p><span data-original="true">${esc(job.fit_analysis.summary)}</span></p><p>Inferred seniority: ${esc(({graduate:'Graduate',junior:'Junior',mid:'Mid-level',senior:'Senior',unknown:'Unknown'} as Record<string,string>)[job.fit_analysis.inferredLevel])}. <span data-original="true">${esc(job.fit_analysis.levelReason)}</span></p>${job.fit_analysis.levelEvidence ? `<blockquote>${esc(job.fit_analysis.levelEvidence)}</blockquote>` : ''}<details><summary>Evidence for strengths and gaps</summary>${[...job.fit_analysis.strengths,...job.fit_analysis.gaps,...job.fit_analysis.hardBlockers].map((item:any)=>`<p><span data-original="true">${esc(item.reason)}</span></p><p>Job evidence: ${esc(item.jobEvidence)}</p>${item.candidateEvidence ? `<p>Candidate evidence: ${esc(item.candidateEvidence)}</p>` : '<p>No corresponding evidence in the CV; confirmation needed.</p>'}`).join('')}</details></section>` : '<p>This job has not yet received an LLM background assessment.</p>'}<p>Skill matches: ${esc((job.strong_matches ?? []).join('; '))}</p><p>Gaps / points to confirm: ${esc((job.main_gaps ?? []).join('; '))}</p><p>Hard blockers: ${esc((job.hard_blockers ?? []).join('; '))}</p><p>Screening notes: ${esc((job.filter_reasons ?? []).map((r: any) => r.message).join('; '))}</p>${pending ? `<form method="post" action="/review/${esc(job.id)}/decision"><input type="hidden" name="token" value="${token(`review-${job.id}`)}"><label>Select CV <select name="selectedCv">${['A1','D1','S1'].map(v => `<option ${v===job.recommended_cv?'selected':''}>${v}</option>`).join('')}</select></label><button name="decision" value="approve">Approve</button><button name="decision" value="skip">Skip</button></form>` : `<p>Saved status: ${esc(job.status)}</p>`}<details><summary>Job description</summary><pre>${esc(job.description)}</pre></details></article>`;
      }).join('') : '<p>No jobs currently pass screening. Run the workflow manually in n8n.</p>'}`,language,url); return;
    }
    if (url.pathname === '/profile') {
      if (req.method === 'POST') {
        const input = await body(req);
        if (!validToken('profile', input.token)) { json(res,403,{error:'Profile token invalid'}); return; }
        const profile = await saveCandidateProfile(JSON.parse(input.profile));
        res.writeHead(303,{ Location: `/profile?version=${profile.profileVersion}` }); res.end(); return;
      }
      if (req.method === 'GET') {
        const version = z.enum(['A1','D1','S1']).parse(url.searchParams.get('version') ?? 'A1');
        const profile = await loadCandidateProfile(version);
        html(res, `<h1>Candidate profile</h1><p>A1: AI · D1: Data · S1: Software. Matching uses only your saved, factual background.</p><p>${['A1','D1','S1'].map(v=>`<a href="/profile?version=${v}">${v}</a>`).join(' · ')}</p><form method="post"><input type="hidden" name="token" value="${token('profile')}"><label>Profile JSON<textarea name="profile">${esc(JSON.stringify(profile ?? { profileVersion:version,skills:[],workExperience:[],projects:[],education:[],targetRoleFamilies:[],languages:[],languageLevels:{} },null,2))}</textarea></label><button>Save profile</button></form>`,language,url); return;
      }
    }
    json(res, 404, { error: 'Not found' });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    json(res, e instanceof z.ZodError || e instanceof SyntaxError ? 400 : /not found/i.test(message) ? 404 : /no longer|missing/i.test(message) ? 409 : 502,
      { error: message });
  }
});
if (process.env.NODE_ENV !== 'test') {
  server.listen(PORT, process.env.API_HOST ?? '0.0.0.0', () => console.log(`Job tracker API on port ${PORT}`));
  const shutdown = () => server.close(() => { void db.end().then(() => process.exit(0)); });
  process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
}
