import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseSearchHtml, parseDetailHtml } from '../src/crawler/publicJobCrawler.js';
import { parseJobDescription, evaluateFit, ruleFilter, candidateProfileSchema } from '../src/services/jobDiscoveryService.js';
const profile = candidateProfileSchema.parse({ profileVersion: 'A1', skills: ['Python', 'TypeScript', 'SQL'], workExperience: [], projects: [], education: [], targetRoleFamilies: ['Software', 'Data', 'AI'], yearsOfExperience: 0.5, languages: ['English', 'Danish'], languageLevels: { English: 'Full Professional', Danish: 'A2' } });

test('workflow links use node names; manual trigger connects to real API', () => {
  const workflow = JSON.parse(readFileSync('workflows/job-tracker-main.json', 'utf8'));
  const names = new Set(workflow.nodes.map((n: any) => n.name));
  assert.equal(workflow.nodes.filter((n: any) => n.type.includes('Trigger')).length, 1);
  for (const [source, connection] of Object.entries(workflow.connections)) {
    assert.ok(names.has(source));
    for (const c of (connection as any).main.flat()) assert.ok(names.has(c.node));
  }
  assert.equal(Object.keys(workflow.connections).length, workflow.nodes.length - 1);
  for (const n of workflow.nodes.filter((n: any) => n.type.endsWith('httpRequest'))) {
    assert.equal(n.parameters.method, 'POST'); assert.equal(n.parameters.specifyBody, 'json');
  }
});
test('public HTML yields stable ids, valid dates and real detail fields', () => {
  const jobs = parseSearchHtml(`<div class="job-search-card" data-entity-urn="urn:li:jobPosting:123"><h3 class="base-search-card__title">Backend Engineer</h3><h4 class="base-search-card__subtitle">O'Neill &amp; Co</h4><span class="job-search-card__location">Copenhagen</span><time datetime="2026-10-01"></time></div>`);
  assert.equal(jobs[0].externalJobId, 'linkedin-123'); assert.equal(jobs[0].company, "O'Neill & Co");
  assert.equal(jobs[0].postedAt, '2026-10-01T00:00:00.000Z');
  const detail = parseDetailHtml('<div class="show-more-less-html__markup"><p>Python</p><p>SQL</p></div><li class="description__job-criteria-item"><h3>Employment type</h3><span class="description__job-criteria-text">Full-time</span></li>');
  assert.match(detail.description, /Python\nSQL/); assert.equal(detail.employmentType, 'Full-time');
  assert.throws(() => parseDetailHtml('<html>Sign in</html>'), /no readable description/);
  assert.throws(() => parseSearchHtml('<html>Security verification</html>'), /requires verification/);
});
test('explicit non-full-time filters out, unknown employment is flagged for review', () => {
  const raw = { title:'Software Engineer',location:'Copenhagen, Denmark',description:'Python SQL backend' };
  assert.equal(ruleFilter({ ...raw,employmentType:'Part-time' }).passes, false);
  assert.equal(ruleFilter(raw).passes, true);
  assert.ok(ruleFilter(raw).reasons.some(r => r.severity === 'soft'));
  assert.equal(ruleFilter({ ...raw,location:'Berlin, Germany' }).passes, false);
});
test('Danish A2 cannot satisfy required fluency; Danish as a plus is not a blocker', () => {
  const mandatory = parseJobDescription('Software development with Python. Must speak fluent Danish. Full-time.');
  assert.deepEqual(mandatory.requiredLanguages, ['Danish']);
  assert.ok(evaluateFit(mandatory, profile).hardBlockers.some(x => /Danish/.test(x)));
  const optional = parseJobDescription('Python software development. Fluent English; Danish is a plus.');
  assert.deepEqual(optional.requiredLanguages, ['English']);
  assert.equal(evaluateFit(optional, profile).hardBlockers.length, 0);
});
test('score responds to declared evidence and respects developer experience', () => {
  const parsed = parseJobDescription('Software development. Python, TypeScript and SQL required. 3+ years of experience.');
  assert.equal(parsed.minimumYears, 3);
  const fit = evaluateFit(parsed, profile);
  assert.ok(fit.hardBlockers.some(x => /3\+ years/.test(x))); assert.equal(fit.recommendation, 'SKIP');
  const junior = parseJobDescription('Junior software development using Python and TypeScript.');
  const match = evaluateFit(junior, profile);
  const mismatch = evaluateFit(junior, { ...profile, skills:['Rust'],targetRoleFamilies:['Law'] });
  assert.ok(match.fitScore > mismatch.fitScore); assert.equal(mismatch.fitScore, 0);
  assert.throws(() => parseJobDescription(''), /required/);
});


test('experience ranges use the lower requirement; unknown technical/language evidence is flagged', () => {
  const parsed = parseJobDescription('Software engineer. 3–5 years of experience. Must speak fluent Danish.');
  assert.equal(parsed.minimumYears, 3);
  const fit = evaluateFit(parsed, { ...profile, languageLevels: {} });
  assert.ok(fit.gaps.some(g => /Confirm required Danish/.test(g)));
  assert.equal(fit.fitScore, 0);
  assert.equal(ruleFilter({ title:'Software Engineer',location:'Copenhagen',description:'Software development',employmentType:'Contract' }).passes, true);
});


test('hard filter excludes senior, three-plus required years and student jobs', () => {
  const raw = { title:'Software Engineer',location:'Copenhagen',description:'Full-time Python software development' };
  const reason = (input: Partial<typeof raw>, code: string) => {
    const result = ruleFilter({ ...raw, ...input });
    assert.equal(result.passes, false);
    assert.ok(result.reasons.some(r => r.code === code && r.severity === 'hard'));
  };
  reason({title:'Senior Software Engineer'},'SENIOR_ROLE');
  reason({title:'Sr. Data Engineer'},'SENIOR_ROLE');
  reason({description:'We are hiring a senior backend engineer. Full-time.'},'SENIOR_ROLE');
  for (const requirement of ['3+ years of experience','3–5 years of experience','At least three years of software development experience','5 years’ relevant experience']) {
    reason({description:requirement},'EXPERIENCE_3_PLUS');
  }
  reason({title:'Student Assistant - Software'},'STUDENT_ROLE');
  reason({title:'Working Student Developer'},'STUDENT_ROLE');
  reason({title:'Studentermedhjælper - Data'},'STUDENT_ROLE');
  reason({description:'You must be a student. Python software development.'},'STUDENT_ROLE');
  reason({description:'Must be currently enrolled in university. Python software development.'},'STUDENT_ROLE');
  for (const description of ['Full-time Python software. 2 years of experience.', 'Full-time Python software. 2–4 years of experience.', 'Full-time Python software. 3 years experience is a plus.', 'Full-time Python software. Collaborate with senior colleagues.', 'Full-time Python software. We build tools for students.']) {
    assert.equal(ruleFilter({...raw,description}).passes,true,description);
  }
});

test('title level and Danish posting hard exclusions apply without confusing location or colleague mentions', () => {
  const raw = {title:'Software Engineer',location:'København, Denmark',description:'We are looking for a software engineer. You will work with senior colleagues and lead development discussions. Danish is a plus, but our working language is English.'};
  for (const title of ['Lead Engineer','Mid-level Developer','Mid Software Engineer','Senior Developer','Sr. Engineer','Software Engineer (mid/senior)'])
    assert.equal(ruleFilter({...raw,title}).passes,false,title);
  assert.equal(ruleFilter({...raw,title:'Middleware Developer'}).passes,true);
  assert.equal(ruleFilter(raw).passes,true);
  assert.equal(ruleFilter({...raw,description:'Vi søger en dygtig udvikler til vores team. Du vil arbejde med udvikling af software og samarbejde med vores kolleger. Vi tilbyder et spændende job med mulighed for faglig udvikling og gode arbejdsforhold.'}).passes,false);
});

test('Danish proficiency phrase is a hard exclusion, English proficiency remains eligible', () => {
 const raw = {title:'Software Engineer',location:'Copenhagen, Denmark',description:'Build Python software APIs. Full-time. Proficiency in Danish.'};
 assert.equal(ruleFilter(raw).passes,false);
 assert.ok(ruleFilter(raw).reasons.some(r=>r.code==='DANISH_PROFICIENCY'));
 assert.equal(ruleFilter({...raw,description:raw.description.replace('Danish','English')}).passes,true);
 assert.equal(ruleFilter({...raw,description:'Python software development. Proficiency in English and Danish.'}).passes,false);
});

test('postdoc roles are excluded while collaboration with postdocs remains eligible', () => {
 const raw={title:'Software Engineer',location:'Copenhagen, Denmark',description:'Full-time Python software development.'};
 for(const title of ['Postdoc in Data Science','Postdoctoral Researcher','Post-doctoral Fellow','Post Doc AI Research']) {
  const result=ruleFilter({...raw,title});
  assert.equal(result.passes,false,title);
  assert.ok(result.reasons.some(r=>r.code==='POSTDOC_ROLE'));
 }
 assert.equal(ruleFilter({...raw,description:'Full-time Python software. This is a postdoctoral research position.'}).passes,false);
 assert.equal(ruleFilter({...raw,description:'Full-time Python software. Work with postdocs and students.'}).passes,true);
});
