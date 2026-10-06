import test from "node:test";
import assert from "node:assert/strict";
import {
  applyRequirementAnalysis,
  requestRequirementAnalysis,
  validateEvidence,
  analysisHash,
  assessJobRequirements,
} from "../src/services/jobRequirementAssessment.js";
import type { RequirementAnalysis } from "../src/services/jobRequirementAssessment.js";
import type { RawJobData } from "../src/domain/job.js";
import {
  parseJobDescription,
  evaluateFit,
  candidateProfileSchema,
} from "../src/services/jobDiscoveryService.js";
const job: RawJobData = {
  externalJobId: "test",
  source: "unknown",
  title: "AI Engineer",
  company: "Test",
  location: "Copenhagen, Denmark",
  description:
    "Full-time Python software development. Work with senior software engineers. Our company has 10 years of experience. Lead a project.",
};
const result = {
  senior: {
    status: "no" as const,
    evidence: "Work with senior software engineers",
    explanation: "描述同事，不是岗位级别",
  },
  student: { status: "no" as const, evidence: "", explanation: "没有在读要求" },
  experience: {
    minimumYears: null,
    evidence: "",
    explanation: "年限描述公司而非申请人",
  },
  uncertainties: [],
};
const analysis: RequirementAnalysis = {
  ...result,
  source: "llm",
  model: "test-model",
  inputHash: analysisHash(job, "test-model"),
  assessedAt: new Date().toISOString(),
};
const configure = () => {
  const keys = ["LLM_ENABLED", "LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY"];
  const previous = keys.map((k) => process.env[k]);
  Object.assign(process.env, {
    LLM_ENABLED: "true",
    LLM_BASE_URL: "https://provider.example/v1",
    LLM_MODEL: "test-model",
    LLM_API_KEY: "test-key",
  });
  return () =>
    keys.forEach((k, i) =>
      previous[i] === undefined
        ? delete process.env[k]
        : (process.env[k] = previous[i]),
    );
};
test("LLM contextual judgment replaces ambiguous keyword exclusions", () => {
  assert.equal(applyRequirementAnalysis(job, analysis).passes, true);
  const parsed = parseJobDescription(job.description!, job.title);
  assert.equal(parsed.seniority, "unspecified");
  const profile = candidateProfileSchema.parse({
    profileVersion: "A1",
    skills: ["Python"],
    targetRoleFamilies: ["AI", "Software"],
    projects: [],
    workExperience: [],
    education: [],
  });
  assert.ok(
    !evaluateFit(parsed, profile).gaps.some((g) => g.includes("Senior role")),
  );
});
test("LLM preserves explicit exclusions and uncertainty", () => {
  assert.equal(
    applyRequirementAnalysis({ ...job, title: "Senior AI Engineer" }, analysis)
      .passes,
    false,
  );
  assert.equal(
    applyRequirementAnalysis(
      { ...job, title: "Working Student Developer" },
      analysis,
    ).passes,
    false,
  );
  assert.equal(
    applyRequirementAnalysis(job, {
      ...analysis,
      experience: { minimumYears: 3, evidence: "", explanation: "要求三年" },
    }).passes,
    false,
  );
  const uncertain = applyRequirementAnalysis(job, {
    ...analysis,
    senior: { status: "unknown", evidence: "", explanation: "职位级别不清楚" },
  });
  assert.equal(uncertain.passes, true);
  assert.ok(
    uncertain.reasons.some((r) => r.code === "LLM_REQUIREMENT_UNCERTAIN"),
  );
});
test("LLM evidence must be an exact source quote and yes verdicts need evidence", () => {
  assert.throws(
    () =>
      validateEvidence(
        {
          ...result,
          senior: {
            status: "yes",
            evidence: "Senior role is required",
            explanation: "高级",
          },
        },
        job,
      ),
    /exact source quote/,
  );
  assert.throws(
    () =>
      validateEvidence(
        {
          ...result,
          experience: {
            minimumYears: 3,
            evidence: "",
            explanation: "要求三年",
          },
        },
        job,
      ),
    /missing/,
  );
});
test("OpenAI-compatible request parses JSON and retries an invalid response once", async () => {
  const restore = configure();
  let calls = 0;
  try {
    const fake = (async (url: any, init: any) => {
      assert.equal(url, "https://provider.example/v1/chat/completions");
      const payload = JSON.parse(init.body);
      assert.equal(payload.response_format.type, "json_object");
      assert.ok(payload.messages[0].content.includes("untrusted DATA"));
      assert.equal(init.redirect, "error");
      calls++;
      return new Response(
        JSON.stringify({
          choices: [
            {
              finish_reason: "stop",
              message: {
                content: calls === 1 ? "invalid" : JSON.stringify(result),
              },
            },
          ],
        }),
      );
    }) as typeof fetch;
    const returned = await requestRequirementAnalysis(job, fake);
    assert.equal(calls, 2);
    assert.equal(returned.senior.status, "no");
    assert.equal(returned.source, "llm");
  } finally {
    restore();
  }
});
test("provider errors do not expose response bodies or silently fall back", async () => {
  const restore = configure();
  try {
    const fake = (async () =>
      new Response("private provider data", { status: 401 })) as typeof fetch;
    await assert.rejects(
      requestRequirementAnalysis(job, fake),
      (error) =>
        error instanceof Error &&
        error.message.includes("HTTP 401") &&
        !error.message.includes("private"),
    );
    process.env.LLM_API_KEY = "";
    await assert.rejects(assessJobRequirements(job), /configuration missing/);
  } finally {
    restore();
  }
});
test("matching cached analysis avoids a provider call", async () => {
  const restore = configure();
  try {
    const assessment = await assessJobRequirements(job, analysis);
    assert.equal(assessment.analysis, analysis);
  } finally {
    restore();
  }
});
