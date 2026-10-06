import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { db } from '../src/db.js';
import { processJob, reviewDecision } from '../src/services/jobProcessor.js';
import { candidateProfileSchema } from '../src/services/jobDiscoveryService.js';
import { server } from '../src/server.js';
import type { RawJobData } from '../src/domain/job.js';
const prefix = `integration-${randomUUID()}`;
const profile = candidateProfileSchema.parse({ profileVersion:'A1',skills:['Python','TypeScript','SQL'],workExperience:[],projects:[],education:[],targetRoleFamilies:['Software'],languages:['English'],yearsOfExperience:0.5 });
const raw = (suffix: string): RawJobData => ({ externalJobId:`${prefix}-${suffix}`,source:'public_job_board',title:"Software Engineer's role",company:"O'Neill & Co",location:'Copenhagen, Denmark',url:'https://example.invalid/fixture',description:'Junior software development using Python TypeScript and SQL. Full-time.',employmentType:'Full-time' });
let base: string;
before(async () => {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No server address');
  base = `http://localhost:${address.port}`;
});
after(async () => {
  await db.query('DELETE FROM jobs WHERE external_job_id LIKE $1', [`${prefix}%`]);
  await new Promise<void>((resolve,reject) => server.close(e => e ? reject(e) : resolve()));
  await db.end();
});
test('bound SQL preserves apostrophes, persists parsed analysis and skips duplicates before detail fetch', async () => {
  const first = await processJob(raw('safe'), profile);
  assert.equal(first.status, 'needs_human_review');
  const job = (await db.query('SELECT * FROM jobs WHERE id=$1',[first.id])).rows[0];
  assert.equal(job.company, "O'Neill & Co"); assert.ok(job.parsed_data); assert.equal(job.fit_score,100);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM job_events WHERE job_id=$1',[first.id])).rows[0].count,1);
  const duplicate = await processJob({ ...raw('safe'),description:undefined }, profile, async () => { throw new Error('Duplicate fetched detail'); });
  assert.equal((duplicate as any).duplicate,true); assert.equal((duplicate as any).id,first.id);
});
test('filtered jobs do not parse/score; failed detail can be retried and raw record exists before fetch', async () => {
  const filtered = await processJob({ ...raw('filter'),employmentType:'Part-time' },profile);
  assert.equal(filtered.status,'filtered_out'); assert.equal(filtered.fitScore,null);
  const retry = { ...raw('retry'),description:undefined };
  await assert.rejects(processJob(retry,profile,async input => {
    const saved = (await db.query('SELECT status FROM jobs WHERE external_job_id=$1',[input.externalJobId])).rows[0];
    assert.equal(saved.status,'discovered'); throw new Error('Temporary source failure');
  }),/Temporary source failure/);
  assert.equal((await db.query('SELECT status FROM jobs WHERE external_job_id=$1',[retry.externalJobId])).rows[0].status,'parsing_failed');
  const completed = await processJob(retry,profile,async () => raw('retry'));
  assert.equal(completed.status,'needs_human_review');
});
test('senior and student roles stop before parsing or scoring', async () => {
  for (const [suffix,title] of [['senior','Senior Software Engineer'],['student','Student Software Developer']]) {
    const result = await processJob({ ...raw(suffix),title,description:' ' },profile);
    assert.equal(result.status,'filtered_out'); assert.equal(result.fitScore,null);
    const saved = (await db.query('SELECT parsed_data,filter_reasons FROM jobs WHERE id=$1',[result.id])).rows[0];
    assert.equal(saved.parsed_data,null); assert.ok(saved.filter_reasons.some((r: any) => r.severity==='hard'));
  }
});
test('LLM analysis overrides colleague/company mentions and persists grounded judgment', async () => {
  const keys=['LLM_ENABLED','LLM_FIT_ENABLED','LLM_BASE_URL','LLM_MODEL','LLM_API_KEY'];
  const previous=keys.map(k=>process.env[k]); const originalFetch=globalThis.fetch;
  try {
    Object.assign(process.env,{LLM_ENABLED:'true',LLM_FIT_ENABLED:'true',LLM_BASE_URL:'https://provider.example/v1',LLM_MODEL:'integration-model',LLM_API_KEY:'test-key'});
    globalThis.fetch=(async (_url: any,init: any) => new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(JSON.parse(init.body).messages[0].content.startsWith('Assess whether') ? {
      suitability:'uncertain',fitScore:55,confidence:'low',inferredLevel:'unknown',levelReason:'描述不足以确认职级',levelEvidence:'',summary:'Python 相关，但职责深度需要确认',
      strengths:[{reason:'Python 匹配',jobEvidence:'Python',candidateEvidence:'Python'}],gaps:[],hardBlockers:[],uncertainties:['确认指导支持'],recommendedCv:'A1'
    } : {
      senior:{status:'no',evidence:'Work with senior software engineers',explanation:'高级指同事'},
      student:{status:'no',evidence:'',explanation:'无需在读'},
      experience:{minimumYears:null,evidence:'',explanation:'年限指公司历史'},uncertainties:[]
    })}}]}))) as typeof fetch;
    const result=await processJob({...raw('llm'),description:'Full-time Python software development. Work with senior software engineers. Our company has 10 years of experience.'},profile);
    assert.equal(result.status,'needs_human_review');
    const saved=(await db.query('SELECT * FROM jobs WHERE id=$1',[result.id])).rows[0];
    assert.equal(saved.fit_analysis.source,'llm'); assert.equal(saved.fit_analysis.suitability,'uncertain');
    assert.equal(saved.requirement_analysis.source,'llm'); assert.equal(saved.requirement_analysis.model,'integration-model');
    assert.equal(saved.parsed_data.minimumYears,undefined);
    assert.ok(!saved.main_gaps.some((g: string)=>g.includes('Senior role')));
  } finally {
    globalThis.fetch=originalFetch;
    keys.forEach((k,i)=>previous[i]===undefined ? delete process.env[k] : process.env[k]=previous[i]);
  }
});
test('concurrent calls cannot double-process a job', async () => {
  let release!: () => void;
  const barrier = new Promise<void>(resolve => { release = resolve; });
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered=resolve; });
  const item = { ...raw('lock'),description:undefined };
  const first = processJob(item,profile,async () => { entered(); await barrier; return raw('lock'); });
  await started;
  try {
    const second = await processJob(item,profile); assert.equal(second.status,'in_progress');
  } finally { release(); }
  await first;
});
test('explicit approval is protected, saved atomically, repeat decisions are rejected; skip is persisted', async () => {
  const job = await processJob(raw('approve'),profile);
  const page = await (await fetch(`${base}/review/${job.id}`)).text();
  const token = page.match(/name="token" value="([a-f0-9]+)"/)?.[1]; assert.ok(token);
  let response = await fetch(`${base}/api/review/${job.id}/decision`,{ method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision:'approve',selectedCv:'A1',token:'invalid'}) });
  assert.equal(response.status,403);
  response = await fetch(`${base}/api/review/${job.id}/decision`,{ method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({decision:'approve',selectedCv:'A1',token}) });
  const approval = await response.json(); assert.equal(response.status,200,JSON.stringify(approval)); assert.equal(approval.status,'approved_to_apply');
  const saved = (await db.query('SELECT * FROM jobs WHERE id=$1',[job.id])).rows[0];
  assert.ok(saved.approved_at); assert.ok(saved.reviewed_at); assert.equal(saved.selected_cv,'A1');
  await assert.rejects(reviewDecision(job.id,'skip','A1'),/no longer/);
  const skipped = await processJob(raw('skip'),profile);
  assert.equal((await reviewDecision(skipped.id,'skip','S1')).status,'skipped');
  assert.equal((await db.query('SELECT approved_at FROM jobs WHERE id=$1',[skipped.id])).rows[0].approved_at,null);
});
test('API rejects missing evaluation fields and cross-origin writes', async () => {
  const missing = await fetch(`${base}/api/agents/evaluate-fit`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  assert.equal(missing.status,400);
  const cross = await fetch(`${base}/api/jobs/process`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://untrusted.example'},body:'{}'});
  assert.equal(cross.status,403);
});
