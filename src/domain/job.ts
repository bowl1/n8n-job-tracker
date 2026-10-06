export type JobStatus =
  | 'discovered'
  | 'filtered_out'
  | 'parsing_failed'
  | 'evaluated'
  | 'not_recommended'
  | 'low_priority'
  | 'needs_human_review'
  | 'skipped'
  | 'approved_to_apply'
  | 'application_material_ready'
  | 'email_opened';

export type Recommendation = 'APPLY' | 'REVIEW' | 'SKIP';

export interface RawJobData {
  id?: string;
  externalJobId: string;
  title: string;
  company: string;
  location: string;
  url: string;
  source: 'linkedin_public' | 'public_job_board' | 'unknown';
  postedAt?: string;
  scrapedAt?: string;
  description?: string;
  rawHtml?: string;
  employmentType?: string;
}

export interface JobFilterReason {
  code: string;
  message: string;
  severity: 'hard' | 'soft';
}

export interface ParsedJobData {
  roleFamily?: string[];
  seniority?: string;
  requiredSkills?: string[];
  niceToHaveSkills?: string[];
  yearsOfExperience?: string;
  languageRequirements?: string[];
  education?: string[];
  responsibilities?: string[];
  hardRequirements?: string[];
  fullTime?: boolean;
  requiredLanguages?: string[];
  minimumYears?: number;
}

export interface CandidateProfile {
  profileVersion: 'A1' | 'D1' | 'S1';
  fullName?: string;
  languageLevels?: Record<string, string>;
  skills: string[];
  workExperience: Array<{
    company: string;
    role: string;
    years: string;
    summary: string;
  }>;
  projects: Array<{
    name: string;
    summary: string;
    stack: string[];
  }>;
  education: string[];
  workPermit?: string;
  languages?: string[];
  yearsOfExperience?: number;
  targetRoleFamilies: string[];
}

export interface FitEvaluationResult {
  fitScore: number;
  hardBlockers: string[];
  strongMatches: string[];
  gaps: string[];
  seniorityMatch: string;
  recommendedCv: 'A1' | 'D1' | 'S1';
  recommendation: Recommendation;
  notes: string;
}

export interface ReviewCard {
  company: string;
  title: string;
  fitScore: number;
  strongMatches: string[];
  mainGaps: string[];
  hardBlockers: string[];
  recommendedCv: 'A1' | 'D1' | 'S1';
  jobUrl: string;
}

export interface ApplicationDecision {
  status: JobStatus;
  reviewedAt?: string;
  approvedAt?: string;
  selectedCv?: 'A1' | 'D1' | 'S1';
}
