#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { CrawlDocumentEvent, CrawlResult } from "./types.js";

interface ParsedCliArgs {
  inputUrl: string;
  outputDir?: string;
  options: {
    maxRetries?: number;
    baseDelayMs?: number;
    timeoutMs?: number;
  };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { inputUrl, options, outputDir } = parseArgs(argv);
  const outputRoot = resolveOutputRoot(inputUrl, outputDir);
  const { crawlLlmsDocs } = await loadCrawler();

  await mkdir(outputRoot, { recursive: true });

  const result = await crawlLlmsDocs(inputUrl, {
    ...options,
    onDocument: async (document) => {
      await persistDocument(outputRoot, document);
    },
    onProgress: (event) => {
      switch (event.type) {
        case "start":
          process.stderr.write(`[llms-txt-crawl] start ${event.inputUrl}\n`);
          break;
        case "probe":
          process.stderr.write(`[llms-txt-crawl] probe ${event.url}\n`);
          break;
        case "crawl":
          process.stderr.write(`[llms-txt-crawl] crawl ${event.url}\n`);
          break;
        case "retry":
          process.stderr.write(
            `[llms-txt-crawl] retry ${event.url} status=${event.statusCode} delay=${event.nextDelayMs}ms attempt=${event.attempt}\n`,
          );
          break;
        case "complete":
          process.stderr.write(
            `[llms-txt-crawl] done success=${event.summary.documentsSucceeded} failed=${event.summary.documentsFailed} skipped=${event.summary.documentsSkipped}\n`,
          );
          break;
      }
    },
  });
  process.stdout.write(formatSummaryOutput(result, outputRoot));
}

async function loadCrawler(): Promise<typeof import("./crawl.js")> {
  const modulePath = import.meta.url.endsWith(".ts") ? "./crawl.ts" : "./crawl.js";
  return import(modulePath);
}

function parseArgs(argv: string[]): ParsedCliArgs {
  if (argv.length === 0) {
    throw new Error(
      "Usage: llms-txt-crawl <url> [--output-dir DIR] [--max-retries N] [--base-delay-ms N] [--timeout-ms N]",
    );
  }

  const [inputUrl, ...rest] = argv;

  if (!inputUrl) {
    throw new Error("Missing input URL.");
  }

  const options: ParsedCliArgs["options"] = {};
  let outputDir: string | undefined;

  for (let index = 0; index < rest.length; index += 2) {
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
  }

  return { inputUrl, outputDir, options };
}

function resolveOutputRoot(
  inputUrl: string,
  outputDir: string | undefined,
  cwd = process.cwd(),
): string {
  if (outputDir) {
    return path.resolve(cwd, outputDir);
  }

  return path.resolve(cwd, "output", new URL(inputUrl).hostname.toLowerCase());
}

async function persistDocument(
  outputRoot: string,
  document: CrawlDocumentEvent,
): Promise<void> {
  const url = new URL(document.url);
  const segments = url.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => sanitizePathSegment(safeDecodeURIComponent(segment)));

  if (segments.length === 0) {
    segments.push("index.txt");
  }

  const lastIndex = segments.length - 1;
  segments[lastIndex] = appendQuerySuffix(
    segments[lastIndex] ?? "index.txt",
    url.searchParams,
  );

  const filePath = path.join(outputRoot, ...segments);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, document.content, "utf8");
}

function formatSummaryOutput(result: CrawlResult, outputRoot: string): string {
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

  return `${basename}__${parts.join("_") || "query"}${parsed.ext}`;
}

function sanitizePathSegment(segment: string): string {
  const sanitized = segment.replace(/[\\/:*?"<>|\u0000-\u001f]/gu, "-").trim();

  if (sanitized === "" || sanitized === "." || sanitized === "..") {
    return "_";
  }

  return sanitized;
}

function sanitizeQueryPart(value: string): string {
  const sanitized = safeDecodeURIComponent(value)
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

function isDirectExecution(): boolean {
  const entryPath = process.argv[1];

  if (!entryPath) {
    return false;
  }

  try {
    return (
      realpathSync(path.resolve(entryPath)) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
