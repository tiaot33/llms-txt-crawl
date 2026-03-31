import type {
  CrawlOptions,
  CrawlResult,
  DocumentNode,
  LinkEdge,
  ProbeResult,
} from "./types.js";

const LLMS_FILENAMES = ["llms.txt", "llms-full.txt", "llms-small.txt"] as const;
const RESTRICTED_STATUS_CODES = new Set([403, 429, 503]);
const DEFAULT_OPTIONS = {
  maxRetries: 3,
  baseDelayMs: 500,
  timeoutMs: 10_000,
} as const;

type CandidateName = (typeof LLMS_FILENAMES)[number];

interface QueueItem {
  url: string;
  sourceUrl?: string;
  prefetched?: FetchOutcome;
}

interface FetchOutcome {
  ok: boolean;
  statusCode?: number;
  attempts: number;
  retries: number;
  content?: string;
  error?: string;
}

export async function crawlLlmsDocs(
  inputUrl: string,
  options: CrawlOptions = {},
): Promise<CrawlResult> {
  const settings = resolveOptions(options);
  const normalizedInputUrl = normalizeInputUrl(inputUrl);
  const baseHostname = new URL(normalizedInputUrl).hostname.toLowerCase();
  const probes: ProbeResult[] = [];
  const documents: DocumentNode[] = [];
  const edges: LinkEdge[] = [];
  const queue: QueueItem[] = [];
  const visited = new Set<string>();
  const skippedRecorded = new Set<string>();

  if (isDirectLlmsUrl(normalizedInputUrl)) {
    probes.push({
      url: normalizedInputUrl,
      probeType: "direct-seed",
      hit: true,
      skipped: false,
      attempts: 0,
      retries: 0,
    });
    queue.push({ url: normalizedInputUrl });
  } else {
    for (const candidateName of LLMS_FILENAMES) {
      const candidateUrl = buildProbeUrl(normalizedInputUrl, candidateName);
      const outcome = await fetchWithRetry(candidateUrl, settings);

      probes.push({
        url: candidateUrl,
        probeType: "candidate",
        candidateName,
        statusCode: outcome.statusCode,
        hit: outcome.ok,
        skipped: false,
        attempts: outcome.attempts,
        retries: outcome.retries,
        error: outcome.error,
      });

      if (outcome.ok) {
        queue.push({
          url: candidateUrl,
          prefetched: outcome,
        });
      }
    }
  }

  while (queue.length > 0) {
    const item = queue.shift();

    if (!item) {
      continue;
    }

    const normalizedUrl = normalizeDocumentUrl(item.url);

    if (item.sourceUrl) {
      edges.push({ from: item.sourceUrl, to: normalizedUrl });
    }

    if (visited.has(normalizedUrl)) {
      continue;
    }

    visited.add(normalizedUrl);

    const outcome = item.prefetched ?? (await fetchWithRetry(normalizedUrl, settings));

    if (!outcome.ok) {
      documents.push({
        url: normalizedUrl,
        sourceUrl: item.sourceUrl,
        status: "failed",
        statusCode: outcome.statusCode,
        attempts: outcome.attempts,
        retries: outcome.retries,
        error: outcome.error,
        discoveredLinks: [],
      });
      continue;
    }

    const discoveredLinks: string[] = [];

    for (const resolvedLink of parseDocumentLinks(outcome.content ?? "", normalizedUrl)) {
      const childUrl = normalizeDocumentUrl(resolvedLink);

      if (isAllowedDiscoveredUrl(childUrl, baseHostname)) {
        discoveredLinks.push(childUrl);
        continue;
      }

      if (!skippedRecorded.has(childUrl)) {
        skippedRecorded.add(childUrl);
        edges.push({ from: normalizedUrl, to: childUrl });
        documents.push({
          url: childUrl,
          sourceUrl: normalizedUrl,
          status: "skipped",
          attempts: 0,
          retries: 0,
          skippedReason: "Cross-domain or unsupported document URL skipped.",
          discoveredLinks: [],
        });
      }
    }

    documents.push({
      url: normalizedUrl,
      sourceUrl: item.sourceUrl,
      status: "success",
      statusCode: outcome.statusCode,
      attempts: outcome.attempts,
      retries: outcome.retries,
      discoveredLinks,
    });

    for (const childUrl of discoveredLinks) {
      queue.push({
        url: childUrl,
        sourceUrl: normalizedUrl,
      });
    }
  }

  return {
    inputUrl: normalizedInputUrl,
    settings,
    probes,
    documents,
    edges,
    summary: buildSummary(probes, documents),
  };
}

function resolveOptions(options: CrawlOptions): Required<CrawlOptions> {
  return {
    maxRetries: normalizeInteger(options.maxRetries, DEFAULT_OPTIONS.maxRetries),
    baseDelayMs: normalizeInteger(options.baseDelayMs, DEFAULT_OPTIONS.baseDelayMs),
    timeoutMs: normalizeInteger(options.timeoutMs, DEFAULT_OPTIONS.timeoutMs),
  };
}

function normalizeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`Invalid numeric option: ${value}`);
  }

  return value;
}

function normalizeInputUrl(inputUrl: string): string {
  const url = new URL(inputUrl);
  url.hash = "";
  return url.toString();
}

function normalizeDocumentUrl(rawUrl: string): string {
  const url = new URL(rawUrl);
  url.hash = "";
  return url.toString();
}

function isDirectLlmsUrl(inputUrl: string): boolean {
  const url = new URL(inputUrl);
  const pathname = trimTrailingSlashes(url.pathname);
  const filename = pathname.split("/").at(-1)?.toLowerCase();
  return filename !== undefined && LLMS_FILENAMES.includes(filename as CandidateName);
}

function buildProbeUrl(inputUrl: string, candidateName: CandidateName): string {
  const url = new URL(inputUrl);
  const pathname = trimTrailingSlashes(url.pathname);
  url.pathname = pathname === "/" ? `/${candidateName}` : `${pathname}/${candidateName}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function trimTrailingSlashes(pathname: string): string {
  const trimmed = pathname.replace(/\/+$/u, "");
  return trimmed === "" ? "/" : trimmed;
}

async function fetchWithRetry(
  url: string,
  settings: Required<CrawlOptions>,
): Promise<FetchOutcome> {
  let attempts = 0;
  let retries = 0;
  let lastStatusCode: number | undefined;
  let lastError: string | undefined;

  while (attempts <= settings.maxRetries) {
    attempts += 1;

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(settings.timeoutMs),
      });

      lastStatusCode = response.status;

      if (response.ok) {
        return {
          ok: true,
          statusCode: response.status,
          attempts,
          retries,
          content: await response.text(),
        };
      }

      lastError = `HTTP ${response.status}`;

      if (!RESTRICTED_STATUS_CODES.has(response.status) || attempts > settings.maxRetries) {
        return {
          ok: false,
          statusCode: response.status,
          attempts,
          retries,
          error: lastError,
        };
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        statusCode: lastStatusCode,
        attempts,
        retries,
        error: lastError,
      };
    }

    retries += 1;
    await sleep(settings.baseDelayMs * 2 ** (retries - 1));
  }

  return {
    ok: false,
    statusCode: lastStatusCode,
    attempts,
    retries,
    error: lastError ?? "Unknown fetch failure.",
  };
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function parseDocumentLinks(content: string, baseUrl: string): string[] {
  const links = new Set<string>();
  const addCandidate = (candidate: string): void => {
    const cleaned = cleanupLinkCandidate(candidate);

    if (!cleaned || !looksLikeDocumentLink(cleaned)) {
      return;
    }

    try {
      links.add(new URL(cleaned, baseUrl).toString());
    } catch {
      // Ignore malformed URLs.
    }
  };

  const inlineLinkPattern =
    /\[[^\]]*\]\(\s*(?:<)?([^)>\s]+)(?:>)?(?:\s+["'][^"']*["'])?\s*\)/gu;
  const referenceLinkPattern = /^\s*\[[^\]]+\]:\s*(\S+)/gmu;
  const autoLinkPattern = /<((?:https?:\/\/)[^>\s]+)>/gu;
  const absoluteUrlPattern = /\bhttps?:\/\/[^\s<>()]+/gu;
  const relativePathPattern =
    /(?:^|[\s(>])((?:\.{1,2}\/|\/)?[A-Za-z0-9._~!$&'()*+,;=:@%-]+(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%-]+)*\.(?:md|txt)(?:[?#][^\s<)]*)?)/gimu;

  for (const match of content.matchAll(inlineLinkPattern)) {
    addCandidate(match[1] ?? "");
  }

  for (const match of content.matchAll(referenceLinkPattern)) {
    addCandidate(match[1] ?? "");
  }

  for (const match of content.matchAll(autoLinkPattern)) {
    addCandidate(match[1] ?? "");
  }

  for (const match of content.matchAll(absoluteUrlPattern)) {
    addCandidate(match[0] ?? "");
  }

  for (const match of content.matchAll(relativePathPattern)) {
    addCandidate(match[1] ?? "");
  }

  return [...links];
}

function cleanupLinkCandidate(candidate: string): string {
  return candidate.trim().replace(/[),.;]+$/u, "");
}

function looksLikeDocumentLink(candidate: string): boolean {
  const withoutQuery = candidate.split(/[?#]/u, 1)[0] ?? candidate;
  return /\.(md|txt)$/iu.test(withoutQuery);
}

function isAllowedDiscoveredUrl(url: string, baseHostname: string): boolean {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    return false;
  }

  if (parsed.hostname.toLowerCase() !== baseHostname) {
    return false;
  }

  return looksLikeDocumentLink(parsed.pathname);
}

function buildSummary(probes: ProbeResult[], documents: DocumentNode[]) {
  return {
    seedsCount: probes.filter((probe) => probe.hit).length,
    probesTotal: probes.length,
    probesHit: probes.filter((probe) => probe.hit).length,
    documentsTotal: documents.length,
    documentsSucceeded: documents.filter((document) => document.status === "success").length,
    documentsFailed: documents.filter((document) => document.status === "failed").length,
    documentsSkipped: documents.filter((document) => document.status === "skipped").length,
    restrictedRetries: probes.reduce((sum, probe) => sum + probe.retries, 0) +
      documents.reduce((sum, document) => sum + document.retries, 0),
  };
}
