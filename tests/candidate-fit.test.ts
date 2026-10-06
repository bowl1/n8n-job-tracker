import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCandidateFit, candidateContext, fitAnalysisHash, validateFitEvidence, fitStatus, evidenceSources, resolveFitOutput } from '../src/services/candidateFitAssessment.js';
import type { RawJobData, CandidateProfile } from '../src/domain/job.js';
const job:RawJobData={externalJobId:'fixture',source:'unknown',title:'Software Engineer',company:'Example',location:'Copenhagen',description:'Build Python APIs with mentoring. Independently own production architecture.'};
const profile:CandidateProfile={profileVersion:'A1',fullName:'Private Name',skills:['Python'],workExperience:[{company:'Private Employer',role:'Student Developer',years:'2025-06 to 2025-11',summary:'Implemented Python APIs'}],projects:[{name:'Forecasting',summary:'Built ML forecasting. https://personal.example',stack:['Python']}],education:['MSc Software Design, completed February 2026'],yearsOfExperience:0.5,languages:['Danish'],languageLevels:{Danish:'A2'},workPermit:'Valid full-time permit in Denmark',targetRoleFamilies:['Software']};
const output={suitability:'stretch',fitScore:65,confidence:'medium',inferredLevel:'mid',levelReason:'承担生产架构，超过已有职业经历，但存在指导支持',levelEvidence:'Independently own production architecture',summary:'项目经验相关，生产架构独立负责程度需要确认',strengths:[{reason:'Python 开发相关',jobEvidence:'Python APIs',candidateEvidence:'Implemented Python APIs'}],gaps:[{reason:'职业开发经验约半年',jobEvidence:'Independently own production architecture',candidateEvidence:'0.5 years of professional development experience'}],hardBlockers:[],uncertainties:['确认指导支持覆盖的范围'],recommendedCv:'A1'};
const configure=()=>{const keys=['LLM_ENABLED','LLM_FIT_ENABLED','LLM_BASE_URL','LLM_MODEL','LLM_API_KEY'];const previous=keys.map(k=>process.env[k]);Object.assign(process.env,{LLM_ENABLED:'true',LLM_FIT_ENABLED:'true',LLM_BASE_URL:'https://provider.example/v1',LLM_MODEL:'test-model',LLM_API_KEY:'test-key'});return()=>keys.forEach((k,i)=>previous[i]===undefined?delete process.env[k]:process.env[k]=previous[i]);};
test('background merges projects from CV variants without name, contacts or URLs',()=>{
  const data=candidateContext([profile,{...profile,profileVersion:'D1',projects:[{name:'Crypto pipeline',summary:'Built a lakehouse',stack:['dbt']}]}]);
  assert.equal(data.projects.length,2); assert.equal(data.professionalDevelopmentYears,0.5);
  assert.ok(!JSON.stringify(data).includes('Private Name'));assert.ok(!JSON.stringify(data).includes('Private Employer'));assert.ok(!JSON.stringify(data).includes('https://'));
});
test('fit judgment is grounded in job and candidate evidence',()=>{
  const result=validateFitEvidence(output,job,[profile]);assert.equal(result.inferredLevel,'mid');
  assert.throws(()=>validateFitEvidence({...output,levelEvidence:'Must have ten years'},job,[profile]),/exact job quote/);
  assert.throws(()=>validateFitEvidence({...output,strengths:[{...output.strengths[0],candidateEvidence:'ten years of production experience'}]},job,[profile]),/candidate evidence/);
  assert.throws(()=>validateFitEvidence({...output,recommendedCv:'S1'},job,[profile]),/supplied profiles/);
  assert.throws(()=>validateFitEvidence({...output,inferredLevel:'senior',suitability:'suitable'},job,[profile]),/conflicts/);
});
test('every passing job is evaluated against background including unspecified-level responsibilities',async()=>{
 const restore=configure();let calls=0;
 try {
  const fetcher=(async (_url:any,init:any)=>{calls++;const body=JSON.parse(init.body);const input=JSON.parse(body.messages[1].content);assert.equal(input.candidate.professionalDevelopmentYears,0.5);assert.ok(body.messages[0].content.includes('NO explicit level'));assert.ok(body.messages[0].content.includes('Do not inflate'));return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(output)}}]}));}) as typeof fetch;
  const result=await assessCandidateFit(job,[profile],null,fetcher);assert.equal(calls,1);assert.equal(result.analysis?.suitability,'stretch');assert.equal(fitStatus(result.fit,result.analysis),'low_priority');
  const cached=await assessCandidateFit(job,[profile],result.analysis,fetcher);assert.equal(calls,1);assert.equal(cached.analysis,result.analysis);
  assert.notEqual(fitAnalysisHash(job,[profile],'test-model'),fitAnalysisHash(job,[{...profile,yearsOfExperience:2}],'test-model'));
 } finally {restore();}
});


test('model source IDs resolve to exact input text and invented IDs are rejected',()=>{
 const sources=evidenceSources(job,[profile]);
 const levelId=sources.job.find(s=>s.text.includes('Independently own'))!.id;
 const jobId=sources.job.find(s=>s.text.includes('Python APIs'))!.id;
 const candidateId=sources.candidate.find(s=>s.text==='Implemented Python APIs')!.id;
 const {levelEvidence,strengths,gaps,...rest}=output;
 const ids={...rest,levelEvidenceId:levelId,strengths:[{reason:'Python 相关',jobEvidenceId:jobId,candidateEvidenceId:candidateId}],gaps:[]};
 const result=resolveFitOutput(ids,job,[profile]);
 assert.equal(result.levelEvidence,'Independently own production architecture.');
 assert.equal(result.strengths[0].candidateEvidence,'Implemented Python APIs');
 assert.throws(()=>resolveFitOutput({...ids,levelEvidenceId:'J999'},job,[profile]),/Unknown job evidence ID/);
});

test('scores below 40 are excluded, exactly 40 is retained', () => {
 const fit = {fitScore:39,hardBlockers:[],strongMatches:[],gaps:[],seniorityMatch:'junior',recommendedCv:'A1',recommendation:'REVIEW',notes:''} as any;
 assert.equal(fitStatus(fit,null),'filtered_out');
 assert.equal(fitStatus({...fit,fitScore:40},null),'low_priority');
});
