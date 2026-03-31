#!/usr/bin/env node

import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { crawlLlmsDocs } from "./crawl.js";
import {
  ensureOutputRoot,
  formatSummaryOutput,
  parseArgs,
  persistDocument,
  resolveOutputRoot,
} from "./cli-support.js";

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { inputUrl, options, outputDir } = parseArgs(argv);
  const outputRoot = resolveOutputRoot(inputUrl, outputDir);

  await ensureOutputRoot(outputRoot);

  const result = await crawlLlmsDocs(inputUrl, {
    ...options,
    onDocument: async (document) => {
      await persistDocument(outputRoot, document);
    },
    onProgress: (event) => {
      switch (event.type) {
        case "start":
          process.stderr.write(`[llms-crawl] start ${event.inputUrl}\n`);
          break;
        case "probe":
          process.stderr.write(`[llms-crawl] probe ${event.url}\n`);
          break;
        case "crawl":
          process.stderr.write(`[llms-crawl] crawl ${event.url}\n`);
          break;
        case "retry":
          process.stderr.write(
            `[llms-crawl] retry ${event.url} status=${event.statusCode} delay=${event.nextDelayMs}ms attempt=${event.attempt}\n`,
          );
          break;
        case "complete":
          process.stderr.write(
            `[llms-crawl] done success=${event.summary.documentsSucceeded} failed=${event.summary.documentsFailed} skipped=${event.summary.documentsSkipped}\n`,
          );
          break;
      }
    },
  });
  process.stdout.write(formatSummaryOutput(result, outputRoot));
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
