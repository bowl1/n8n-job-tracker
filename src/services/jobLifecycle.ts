import type { CandidateProfile, FitEvaluationResult, JobStatus, RawJobData, ReviewCard } from '../domain/job.js';

export interface JobLifecycleState {
  status: JobStatus;
  reason?: string;
}

export function afterRawSave(rawJob: RawJobData): JobLifecycleState {
  return {
    status: 'discovered',
    reason: `Saved raw job ${rawJob.externalJobId} before evaluation.`,
  };
}

export function afterFilterDecision(passes: boolean, reasons: string[]): JobLifecycleState {
  if (!passes) {
    return { status: 'filtered_out', reason: reasons.join('; ') };
  }

  return { status: 'discovered', reason: 'Passed rule filter and awaiting parsing.' };
}

export function afterFitEvaluation(result: FitEvaluationResult): JobLifecycleState {
  if (result.hardBlockers.length > 0) {
    return { status: 'not_recommended', reason: 'Hard blockers were detected.' };
  }

  if (result.fitScore < 60) {
    return { status: 'low_priority', reason: 'Fit score is below the review threshold.' };
  }

  return { status: 'needs_human_review', reason: 'Ready for human review.' };
}

export function afterReviewDecision(approved: boolean, selectedCv: 'A1' | 'D1' | 'S1', reviewCard: ReviewCard): JobLifecycleState {
  if (approved) {
    return {
      status: 'approved_to_apply',
      reason: `Approved for ${selectedCv} with review card for ${reviewCard.company}.`,
    };
  }

  return { status: 'skipped', reason: 'User skipped the role.' };
}

export function buildProfileSummary(profile: CandidateProfile): string {
  return `${profile.profileVersion}: ${profile.skills.slice(0, 4).join(', ')}`;
}
