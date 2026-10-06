import { franc } from 'franc';
import type {
  CandidateProfile,
  FitEvaluationResult,
  JobFilterReason,
  ParsedJobData,
  RawJobData,
  ReviewCard,
} from "../domain/job.js";
import { db } from "../db.js";
import { z } from "zod";

export const candidateProfileSchema = z.object({
  profileVersion: z.enum(["A1", "D1", "S1"]),
  fullName: z.string().optional(),
  languageLevels: z.record(z.string()).default({}),
  skills: z.array(z.string().trim().min(1)).min(1),
  workExperience: z.array(
    z.object({
      company: z.string(),
      role: z.string(),
      years: z.string(),
      summary: z.string(),
    }),
  ),
  projects: z.array(
    z.object({
      name: z.string(),
      summary: z.string(),
      stack: z.array(z.string()),
    }),
  ),
  education: z.array(z.string()),
  workPermit: z.string().optional(),
  targetRoleFamilies: z.array(z.string().trim().min(1)).min(1),
  languages: z.array(z.string()).default([]),
  yearsOfExperience: z.number().min(0).max(70).optional(),
});
export interface RuleFilterResult {
  passes: boolean;
  reasons: JobFilterReason[];
}
export function normalizeRawJob(
  job: Partial<RawJobData> | undefined,
): RawJobData {
  if (
    !job?.externalJobId ||
    !job.title ||
    !job.url ||
    !job.company ||
    !job.location
  )
    throw new Error("Missing required raw job fields");
  return {
    ...job,
    externalJobId: job.externalJobId,
    title: job.title,
    company: job.company,
    location: job.location,
    url: job.url,
    source: job.source ?? "unknown",
  };
}
function requiredExperienceYears(description: string): number[] {
  const core = description
    .split(/[\n;!?]+|\.\s+/)
    .filter(
      (s) =>
        !/nice to have|a plus|preferred|advantage|bonus|desirable|not required|no .*experience required/i.test(
          s,
        ),
    )
    .join(" ");
  const normalized = core.replace(
    /\b(three|four|five|six|seven|eight|nine|ten)\b/gi,
    (word) =>
      String(
        (
          {
            three: 3,
            four: 4,
            five: 5,
            six: 6,
            seven: 7,
            eight: 8,
            nine: 9,
            ten: 10,
          } as Record<string, number>
        )[word.toLowerCase()],
      ),
  );
  const matches = [
    ...normalized.matchAll(
      /(\d{1,2})(?:\s*[-–]\s*\d{1,2})?\s*\+?\s*years?['’]?\s+(?:of\s+)?(?:[\w-]+\s+){0,4}experience/gi,
    ),
  ].map((m) => Number(m[1]));
  return matches;
}

export function absoluteExclusions(job: {title?: string; description?: string; fit_score?: number | null; fitScore?: number}): JobFilterReason[] {
  const reasons: JobFilterReason[] = [];
  if (/(?:^|[^\p{L}\p{N}])(?:lead|mid(?:[- ]?level)?|senior|sr\.?)(?=$|[^\p{L}\p{N}])/iu.test(job.title ?? ''))
    reasons.push({code: 'EXCLUDED_TITLE_LEVEL', message: 'Title contains Lead, Mid or Senior; excluded.', severity: 'hard'});
  const postdoc = /\bpost[- ]?doc(?:toral|torate)?s?\b|\bpostdoktor(?:al)?\b/i;
  const postdocRole = /\bpost[- ]?doc(?:toral|torate)?\s+(?:research\s+)?(?:position|role|fellow(?:ship)?|researcher|associate|appointment)\b|\b(?:position|role|appointment)\s+(?:as|for|of)\s+(?:a\s+)?post[- ]?doc(?:toral)?\b/i;
  if (postdoc.test(job.title ?? '') || postdocRole.test(job.description ?? ''))
    reasons.push({code: 'POSTDOC_ROLE', message: 'Postdoctoral positions are excluded.', severity: 'hard'});
  const body = (job.description ?? '').replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+/g, ' ');
  if (franc(body, {minLength: 40}) === 'dan')
    reasons.push({code: 'DANISH_POSTING', message: 'Job description is written in Danish; excluded.', severity: 'hard'});
  if (/\bproficiency\s+in\s+(?:both\s+)?(?:English\s+(?:and|&)\s+)?Danish\b/i.test(body))
    reasons.push({code: 'DANISH_PROFICIENCY', message: 'JD mentions proficiency in Danish; excluded.', severity: 'hard'});
  const score = job.fitScore ?? job.fit_score;
  if (typeof score === 'number' && score < 40)
    reasons.push({code: 'FIT_SCORE_BELOW_40', message: `Match score ${score} is below 40; excluded.`, severity: 'hard'});
  return reasons;
}

export function ruleFilter(job: Partial<RawJobData>): RuleFilterResult {
  const reasons: JobFilterReason[] = [];
  const add = (
    code: string,
    message: string,
    severity: "hard" | "soft" = "hard",
  ) => reasons.push({ code, message, severity });
  if (
    !/denmark|copenhagen|københavn|aarhus|århus|odense|aalborg/i.test(
      job.location ?? "",
    )
  )
    add("LOCATION_MISMATCH", "Outside the Denmark target area.");
  if (/part[- ]time/i.test(job.employmentType ?? ""))
    add("NOT_FULL_TIME", "Employment type is not full-time.");
  else if (
    !/full[- ]?time/i.test(
      `${job.employmentType ?? ""} ${job.description ?? ""}`,
    )
  )
    add(
      "FULL_TIME_UNCONFIRMED",
      "Full-time employment needs human confirmation.",
      "soft",
    );
  if (
    !/\b(software|data|ai|ml|backend|platform|engineer|analyst|developer)\b/i.test(
      `${job.title ?? ""} ${job.description ?? ""}`,
    )
  )
    add("SCOPE_MISMATCH", "Outside software/data/AI roles.");
  reasons.push(...absoluteExclusions(job));
  const title = job.title ?? "";
  const description = job.description ?? "";
  if (
    /\b(senior|sr\.?)\b/i.test(title) ||
    /\b(?:senior|sr\.?)\s+(?:[\w-]+\s+){0,4}(?:engineer|developer|analyst|scientist|architect|position|role)\b|\b(?:position|role)\s+(?:is\s+)?(?:at\s+)?senior\b/i.test(
      description,
    )
  ) {
    add("SENIOR_ROLE", "Senior positions are excluded.");
  }
  const years = requiredExperienceYears(description);
  if (years.some((year) => year >= 3))
    add(
      "EXPERIENCE_3_PLUS",
      "The job explicitly requires at least 3 years of experience.",
    );
  const studentRole =
    /\bstudent(?:\s+(?:assistant|worker|employee|developer|job))?\b|\bworking[- ]student\b|studentermedhjælper|studenterjob/i;
  const studentRequirement =
    /\b(?:must|should|need to)\s+(?:currently\s+)?be\s+(?:a\s+)?student\b|\b(?:currently|actively)\s+enrolled\b|\b(?:student|working[- ]student)\s+(?:position|role|job|assistant)\b|\b(?:looking for|seeking|hiring)\s+(?:a\s+)?(?:[\w-]+\s+){0,2}student\b|studentermedhjælper|studenterjob/i;
  if (
    studentRole.test(title) ||
    studentRole.test(job.employmentType ?? "") ||
    studentRequirement.test(description)
  ) {
    add(
      "STUDENT_ROLE",
      "Student jobs and roles requiring current student enrollment are excluded.",
    );
  }
  return { passes: !reasons.some((r) => r.severity === "hard"), reasons };
}

const skillPatterns: [string, RegExp][] = [
  ["Python", /\bpython\b/i],
  ["TypeScript", /\btypescript\b/i],
  ["JavaScript", /\bjavascript\b/i],
  ["Node.js", /\bnode(?:\.js|js)?\b/i],
  ["SQL", /\bsql\b/i],
  ["PostgreSQL", /\bpostgres(?:ql)?\b/i],
  ["Java", /\bjava\b/i],
  ["C#", /\bc#|\bc sharp\b/i],
  ["C++", /\bc\+\+/i],
  ["Go", /\bgolang\b|\bgo (?:language|programming)\b/i],
  ["React", /\breact\b/i],
  ["Docker", /\bdocker\b/i],
  ["Kubernetes", /\bkubernetes\b/i],
  ["AWS", /\baws\b/i],
  ["Azure", /\bazure\b/i],
  ["LLM", /\bllms?\b|large language model/i],
  ["Machine learning", /\bmachine learning\b|\bml\b/i],
  ["n8n", /\bn8n\b/i],
];
export function parseJobDescription(description: string, title = ""): ParsedJobData {
  if (!description.trim()) throw new Error("Job description is required");
  const sentences = description
    .split(/[\n;!?]+|\.\s+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const nice = sentences
    .filter((x) =>
      /nice to have|a plus|preferred|advantage|bonus|desirable/i.test(x),
    )
    .join(" ");
  const core = sentences
    .filter(
      (x) =>
        !/nice to have|a plus|preferred|advantage|bonus|desirable/i.test(x),
    )
    .join(" ");
  const languages = ["English", "Danish"].filter((x) =>
    new RegExp(`\\b${x}\\b`, "i").test(description),
  );
  const requiredLanguages = languages.filter((language) =>
    sentences.some(
      (s) =>
        new RegExp(`\\b${language}\\b`, "i").test(s) &&
        /fluent|fluency|must|required|mandatory|proficien/i.test(s) &&
        !/a plus|preferred|advantage|bonus|desirable/i.test(s),
    ),
  );
  const years = requiredExperienceYears(description);
  return {
    roleFamily: [
      /software|backend|platform|developer/i.test(description)
        ? "Software"
        : "",
      /\bdata\b|analytics/i.test(description) ? "Data" : "",
      /\bai\b|\bml\b|\bllm\b/i.test(description) ? "AI" : "",
    ].filter(Boolean),
    seniority: /\b(senior|sr\.?)\b/i.test(title)
      ? "senior"
      : /\b(junior|graduate)\b/i.test(title)
        ? "junior"
        : "unspecified",
    requiredSkills: skillPatterns
      .filter(([, re]) => re.test(core))
      .map(([name]) => name),
    niceToHaveSkills: skillPatterns
      .filter(([, re]) => re.test(nice) && !re.test(core))
      .map(([name]) => name),
    minimumYears: years.length ? Math.max(...years) : undefined,
    yearsOfExperience: years.length
      ? `${Math.max(...years)}+ years`
      : undefined,
    languageRequirements: languages,
    requiredLanguages,
    responsibilities: sentences.slice(0, 8),
    education: sentences.filter((s) => /degree|bachelor|master|phd/i.test(s)),
    hardRequirements: [
      ...requiredLanguages.map((l) => `${l} proficiency required`),
      ...(/(?:must|required|need).{0,60}(?:work (?:permit|authorization)|right to work)/i.test(
        core,
      )
        ? ["Work authorization required"]
        : []),
    ],
    fullTime: /full[- ]?time/i.test(description),
  };
}

export async function loadCandidateProfile(
  version: "A1" | "D1" | "S1" = "A1",
): Promise<CandidateProfile | null> {
  const result = await db.query(
    "SELECT profile_data FROM candidate_profiles WHERE profile_version = $1 ORDER BY updated_at DESC LIMIT 1",
    [version],
  );
  if (!result.rows[0]?.profile_data) return null;
  return candidateProfileSchema.parse(result.rows[0].profile_data);
}
export async function saveCandidateProfile(
  input: unknown,
): Promise<CandidateProfile> {
  const profile = candidateProfileSchema.parse(input);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `profile-${profile.profileVersion}`,
    ]);
    await client.query(
      "DELETE FROM candidate_profiles WHERE profile_version=$1",
      [profile.profileVersion],
    );
    await client.query(
      `INSERT INTO candidate_profiles (profile_version, skills, work_experience, projects, education, work_permit, target_role_families, profile_data)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        profile.profileVersion,
        JSON.stringify(profile.skills),
        JSON.stringify(profile.workExperience),
        JSON.stringify(profile.projects),
        JSON.stringify(profile.education),
        profile.workPermit ?? null,
        JSON.stringify(profile.targetRoleFamilies),
        JSON.stringify(profile),
      ],
    );
    await client.query("COMMIT");
    return profile;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

const canonical = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9+#]/g, "")
    .replace(/llmapis?/, "llm")
    .replace(/^nodejs$/, "node")
    .replace(/^postgres$/, "postgresql");
export function evaluateFit(
  parsed: ParsedJobData,
  profile: CandidateProfile,
): FitEvaluationResult {
  const skills = new Set(profile.skills.map(canonical));
  const required = parsed.requiredSkills ?? [];
  const matched = required.filter((skill) => skills.has(canonical(skill)));
  const gaps = required
    .filter((skill) => !skills.has(canonical(skill)))
    .map((skill) => `No declared evidence for ${skill}`);
  const hardBlockers: string[] = [];
  for (const language of parsed.requiredLanguages ?? []) {
    const declared = profile.languages?.some(
      (x) => canonical(x) === canonical(language),
    );
    const level = Object.entries(profile.languageLevels ?? {}).find(
      ([key]) => canonical(key) === canonical(language),
    )?.[1];
    if (!profile.languages?.length || (declared && !level))
      gaps.push(`Confirm required ${language} proficiency`);
    else if (
      !declared ||
      /^(a1|a2|b1|beginner|basic|elementary)/i.test(level ?? "")
    )
      hardBlockers.push(
        `${language} proficiency required, not demonstrated in profile`,
      );
  }
  if (
    (parsed.hardRequirements ?? []).some((x) => /work authorization/i.test(x))
  ) {
    if (!profile.workPermit) gaps.push("Confirm work authorization");
    else if (
      /^(no|not eligible|requires sponsorship|need sponsorship)/i.test(
        profile.workPermit,
      )
    )
      hardBlockers.push("Work authorization needs resolution");
  }
  let points = 0,
    available = 0;
  if (required.length) {
    available += 70;
    points += (70 * matched.length) / required.length;
  }
  const families = parsed.roleFamily ?? [];
  if (families.length) {
    available += 20;
    if (
      families.some((f) =>
        profile.targetRoleFamilies.some(
          (t) =>
            canonical(t).includes(canonical(f)) ||
            canonical(f).includes(canonical(t)),
        ),
      )
    )
      points += 20;
    else gaps.push("Role family differs from declared targets");
  }
  if (parsed.minimumYears !== undefined) {
    if (profile.yearsOfExperience === undefined)
      gaps.push(`Confirm ${parsed.minimumYears}+ years of experience`);
    else {
      available += 10;
      points +=
        10 *
        Math.min(
          profile.yearsOfExperience / Math.max(parsed.minimumYears, 1),
          1,
        );
      if (profile.yearsOfExperience < parsed.minimumYears)
        hardBlockers.push(
          `Requires ${parsed.minimumYears}+ years; profile declares ${profile.yearsOfExperience}`,
        );
    }
  }
  const fitScore =
    required.length && available ? Math.round((points / available) * 100) : 0;
  if (!required.length)
    gaps.push(
      "Insufficient explicit technical requirements to score; read the full job description",
    );
  return {
    fitScore,
    hardBlockers,
    strongMatches: matched.map((s) => `Declared skill: ${s}`),
    gaps,
    seniorityMatch: parsed.seniority ?? "unspecified",
    recommendedCv: profile.profileVersion,
    recommendation: hardBlockers.length || fitScore < 60 ? "SKIP" : "REVIEW",
    notes:
      "Transparent keyword-based evidence score; unlisted skills and unknown requirements require human verification. No LLM or invented candidate history.",
  };
}
export function buildReviewCard(
  title: string,
  company: string,
  fitScore: number,
  strongMatches: string[],
  gaps: string[],
  hardBlockers: string[],
  recommendedCv: "A1" | "D1" | "S1",
  jobUrl: string,
): ReviewCard {
  return {
    company,
    title,
    fitScore,
    strongMatches,
    mainGaps: gaps,
    hardBlockers,
    recommendedCv,
    jobUrl,
  };
}
