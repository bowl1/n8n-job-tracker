import { load } from 'cheerio';
export type UiLanguage = 'en' | 'zh';
const labels: Record<string,string> = {
 'Job Tracker':'职位追踪','Job review':'岗位审核','Candidate profile':'候选人资料',
 'LLM assessment is disabled. Matching uses rules and skill evidence.':'LLM 未启用，目前使用规则判断及技能证据评分。',
 'The LLM assesses every new job that passes screening against your background. When seniority is unspecified, it examines responsibilities and expected independence.':'LLM 会结合你的完整背景评估每个通过初筛的新增岗位；未写职级时，分析职责与独立负责程度。',
 'The LLM assesses seniority, student requirements and required experience. Background matching is not enabled.':'LLM 判断职级、学生身份和必需经验；背景匹配尚未启用。',
 'Click Approve to mark a job as approved to apply. Applications are not sent automatically.':'点击批准后记录为待申请，不会自动投递。',
 'Check the original posting for mandatory requirements.':'请核实原始职位中的必备条件。',
 'Match score':'匹配分','Not assessed':'未评估','Recommended CV':'推荐简历','View original posting':'查看原始职位',
 'LLM requirements assessment and evidence':'LLM 要求判断及原文依据','Seniority:':'岗位级别：','Experience requirements:':'经验要求：','Student requirements:':'学生要求：',
 'This job has not yet received an LLM requirements assessment.':'此岗位尚未进行 LLM 要求判断。',
 'Match against your background':'与你的背景匹配','Verdict:':'结论：','Stretch opportunity':'可以尝试，有挑战','Uncertain; more information needed':'信息不足，需确认','Unsuitable':'不太适合','Suitable':'适合',
 'Confidence:':'判断把握：','High':'较高','Medium':'中等','Low':'较低','Inferred seniority:':'推断职级：','Graduate':'毕业生','Junior':'初级','Mid-level':'中级','Senior':'高级','Unknown':'不明确',
 'Evidence for strengths and gaps':'匹配与差距的证据','Job evidence:':'职位原文：','Candidate evidence:':'背景依据：','No corresponding evidence in the CV; confirmation needed.':'简历中尚无对应证据，需确认。',
 'This job has not yet received an LLM background assessment.':'此岗位尚未进行 LLM 背景匹配判断。',
 'Skill matches:':'技能匹配：','Gaps / points to confirm:':'待确认／差距：','Hard blockers:':'硬性障碍：','Screening notes:':'筛选说明：','Select CV':'选择简历','Approve':'批准申请','Skip':'跳过','Saved status:':'已保存状态：','Job description':'职位描述',
 'No jobs currently pass screening. Run the workflow manually in n8n.':'暂无符合筛选条件的岗位。可在 n8n 手动执行工作流。',
 'A1: AI · D1: Data · S1: Software. Matching uses only your saved, factual background.':'A1：AI · D1：数据 · S1：软件。匹配只依据保存的真实资料。',
 'Profile JSON':'JSON 资料','Save profile':'保存资料',
 'Existing assessments and original evidence retain their saved language.':'已有分析和原文证据保留保存时的语言。',
};
export function resolveUiLanguage(query: string|null, cookie: string|undefined): UiLanguage {
 if(query==='en'||query==='zh')return query;
 return /(?:^|;\s*)ui_language=zh(?:;|$)/.test(cookie ?? '') ? 'zh':'en';
}
const keys=Object.keys(labels).sort((a,b)=>b.length-a.length);
const pattern=new RegExp(keys.map(key=>key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|'),'g');
export function localizeUi(markup:string,language:UiLanguage) {
 const $=load(markup);
 $('html').attr('lang',language);
 if(language==='zh') {
  const visit=(node:any)=> {
   if(node.type==='text')node.data=node.data.replace(pattern,(text:string)=>labels[text]);
   else if(!['pre','textarea','blockquote','style','script'].includes(node.name) && !node.attribs?.['data-original']) for(const child of node.children ?? [])visit(child);
  };
  visit($.root()[0]);
 }
 return $.html();
}
