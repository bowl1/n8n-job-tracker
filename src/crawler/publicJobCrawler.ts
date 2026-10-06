import { load } from "cheerio";
import type { RawJobData } from "../domain/job.js";

export type PublicJobSearchItem = RawJobData;
const clean = (text: string) => text.replace(/\s+/g, " ").trim();

let requestQueue: Promise<unknown> = Promise.resolve();
let nextRequestAt = 0;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function publicHtml(url: string): Promise<string> {
  const request = requestQueue
    .catch(() => undefined)
    .then(async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        if (nextRequestAt - Date.now() > 20000)
          throw new Error(
            `Public source cooling down; retry after ${Math.ceil((nextRequestAt - Date.now()) / 1000)} seconds.`,
          );
        await delay(Math.max(0, nextRequestAt - Date.now()));
        nextRequestAt = Date.now() + 1500;
        const response = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0", "Accept-Language": "en" },
          signal: AbortSignal.timeout(20000),
        });
        if (response.status === 429 || response.status >= 500) {
          const header = response.headers.get("retry-after");
          const requested = header
            ? /^\d+$/.test(header)
              ? Number(header) * 1000
              : Date.parse(header) - Date.now()
            : 5000;
          const wait = Number.isFinite(requested)
            ? Math.max(5000, requested)
            : 5000;
          await response.body?.cancel();
          nextRequestAt = Date.now() + wait;
          if (attempt === 0 && wait <= 20000) continue;
          throw new Error(
            `Public job source returned HTTP ${response.status}; retry after ${Math.ceil(wait / 1000)} seconds. No sample data substituted.`,
          );
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new Error(
            `Public job source returned HTTP ${response.status}; no sample data substituted.`,
          );
        }
        return response.text();
      }
      throw new Error("Public source request failed");
    });
  requestQueue = request;
  return request;
}

export function parseSearchHtml(html: string): RawJobData[] {
  const $ = load(html);
  const jobs: RawJobData[] = [];
  $(".job-search-card").each((_, element) => {
    const card = $(element);
    const id = card.attr("data-entity-urn")?.match(/jobPosting:(\d+)/)?.[1];
    const title = clean(card.find(".base-search-card__title").text());
    if (!id || !title) return;
    const date = card.find("time").attr("datetime");
    jobs.push({
      externalJobId: `linkedin-${id}`,
      source: "linkedin_public",
      title,
      company: clean(card.find(".base-search-card__subtitle").text()),
      location: clean(card.find(".job-search-card__location").text()),
      url: `https://www.linkedin.com/jobs/view/${id}`,
      postedAt:
        date && !Number.isNaN(Date.parse(date))
          ? new Date(date).toISOString()
          : undefined,
      scrapedAt: new Date().toISOString(),
    });
  });
  if (
    !jobs.length &&
    /authwall|captcha|sign in to|security verification/i.test(html)
  ) {
    throw new Error(
      "Public job source requires verification. No login or bypass attempted.",
    );
  }
  return jobs;
}

export async function fetchPublicJobSearch(
  options: {
    keywords?: string;
    location?: string;
    page?: number;
    start?: number;
    limit?: number;
  } = {},
): Promise<RawJobData[]> {
  const url = new URL(
    "https://www.linkedin.com/jobs-guest/jobs/api/seeMoreJobPostings/search",
  );
  url.search = new URLSearchParams({
    keywords: options.keywords ?? "software engineer data AI",
    location: options.location ?? "Copenhagen, Denmark",
    start: String(options.start ?? ((options.page ?? 1) - 1) * 10),
    f_JT: "F",
    f_TPR: "r259200",
    sortBy: "DD",
  }).toString();
  const html = await publicHtml(url.toString());
  const cutoff = Date.now() - 3 * 86400000;
  return parseSearchHtml(html)
    .filter((job) => job.postedAt && Date.parse(job.postedAt) >= cutoff)
    .slice(0, options.limit ?? 25);
}

export function parseDetailHtml(html: string): {
  description: string;
  employmentType?: string;
} {
  const $ = load(html);
  const body = $(".show-more-less-html__markup").first();
  body.find("br").replaceWith("\n");
  body.find("p,li,h2,h3").append("\n");
  const description = body
    .text()
    .replace(/[\t ]+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim();
  let employmentType: string | undefined;
  $(".description__job-criteria-item").each((_, element) => {
    if (/employment type/i.test($(element).find("h3").text()))
      employmentType = clean(
        $(element).find(".description__job-criteria-text").text(),
      );
  });
  if (!description)
    throw new Error("Public job detail has no readable description.");
  return { description, employmentType };
}

export async function fetchPublicJobDetail(
  job: RawJobData,
): Promise<RawJobData> {
  const id = job.externalJobId.match(/^linkedin-(\d+)$/)?.[1];
  if (!id) throw new Error("Invalid LinkedIn external job id");
  const html = await publicHtml(
    `https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/${id}`,
  );
  return {
    ...job,
    ...parseDetailHtml(html),
    scrapedAt: new Date().toISOString(),
  };
}
export const normalizePublicJobCandidate = (
  item: PublicJobSearchItem,
): RawJobData => item;
