import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { CrawlDocumentEvent, CrawlResult } from "./types.js";

interface NumericOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
}

export interface ParsedCliArgs {
  inputUrl: string;
  outputDir?: string;
  options: NumericOptions;
}

export function parseArgs(argv: string[]): ParsedCliArgs {
  if (argv.length === 0) {
    throw new Error(
      "Usage: llms-crawl <url> [--output-dir DIR] [--max-retries N] [--base-delay-ms N] [--timeout-ms N]",
    );
  }

  const [inputUrl, ...rest] = argv;

  if (!inputUrl) {
    throw new Error("Missing input URL.");
  }

  const options: NumericOptions = {};
  let outputDir: string | undefined;

  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    const value = rest[index + 1];

    if (!flag?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${flag}`);
    }

    if (value === undefined) {
      throw new Error(`Missing value for ${flag}`);
    }

    switch (flag) {
      case "--output-dir":
        outputDir = value;
        break;
      case "--max-retries":
        options.maxRetries = parseNumericFlag(flag, value);
        break;
      case "--base-delay-ms":
        options.baseDelayMs = parseNumericFlag(flag, value);
        break;
      case "--timeout-ms":
        options.timeoutMs = parseNumericFlag(flag, value);
        break;
      default:
        throw new Error(`Unknown flag: ${flag}`);
    }

    index += 1;
  }

  return { inputUrl, outputDir, options };
}

export function resolveOutputRoot(
  inputUrl: string,
  outputDir: string | undefined,
  cwd = process.cwd(),
): string {
  if (outputDir) {
    return path.resolve(cwd, outputDir);
  }

  const hostname = new URL(inputUrl).hostname.toLowerCase();
  return path.resolve(cwd, "output", hostname);
}

export async function persistDocument(
  outputRoot: string,
  document: CrawlDocumentEvent,
): Promise<string> {
  const relativePath = buildRelativeOutputPath(document.url);
  const absolutePath = path.join(outputRoot, ...relativePath.split("/"));

  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, document.content, "utf8");

  return relativePath;
}

export async function ensureOutputRoot(outputRoot: string): Promise<void> {
  await mkdir(outputRoot, { recursive: true });
}

export function formatSummaryOutput(result: CrawlResult, outputRoot: string): string {
  const failedUrls = result.documents
    .filter((document) => document.status === "failed")
    .map((document) => document.url);
  const lines = [
    `success=${result.summary.documentsSucceeded} failed=${result.summary.documentsFailed} output="${outputRoot}"`,
  ];

  if (failedUrls.length > 0) {
    lines.push("failed-pages:", ...failedUrls);
  }

  return `${lines.join("\n")}\n`;
}

function parseNumericFlag(flag: string, value: string): number {
  const parsedValue = Number.parseInt(value, 10);

  if (!Number.isInteger(parsedValue) || parsedValue < 0) {
    throw new Error(`Invalid value for ${flag}: ${value}`);
  }

  return parsedValue;
}

function buildRelativeOutputPath(urlString: string): string {
  const url = new URL(urlString);
  const pathSegments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => sanitizePathSegment(safeDecodeURIComponent(segment)));

  if (pathSegments.length === 0) {
    pathSegments.push("index.txt");
  }

  const lastSegmentIndex = pathSegments.length - 1;
  pathSegments[lastSegmentIndex] = appendQuerySuffix(
    pathSegments[lastSegmentIndex] ?? "index.txt",
    url.searchParams,
  );

  return pathSegments.join("/");
}

function appendQuerySuffix(filename: string, searchParams: URLSearchParams): string {
  const parts = [...searchParams.entries()]
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      if (leftKey === rightKey) {
        return leftValue.localeCompare(rightValue);
      }

      return leftKey.localeCompare(rightKey);
    })
    .map(([key, value]) => {
      const safeKey = sanitizeQueryPart(key);
      const decodedValue = safeDecodeURIComponent(value);

      if (decodedValue === "") {
        return safeKey;
      }

      return `${safeKey}-${sanitizeQueryPart(decodedValue)}`;
    });

  if (parts.length === 0) {
    return filename;
  }

  const parsed = path.posix.parse(filename);
  const basename = parsed.name || "file";
  const suffix = parts.join("_") || "query";

  return `${basename}__${suffix}${parsed.ext}`;
}

function sanitizePathSegment(segment: string): string {
  const sanitized = segment.replace(/[\\/:*?"<>|\u0000-\u001f]/gu, "-").trim();

  if (sanitized === "" || sanitized === "." || sanitized === "..") {
    return "_";
  }

  return sanitized;
}

function sanitizeQueryPart(value: string): string {
  const decoded = safeDecodeURIComponent(value);
  const sanitized = decoded
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/-+/gu, "-")
    .replace(/^[-_.]+|[-_.]+$/gu, "");

  return sanitized || "value";
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
