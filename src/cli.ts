#!/usr/bin/env node

import { crawlLlmsDocs } from "./crawl.js";

async function main(): Promise<void> {
  const { inputUrl, options } = parseArgs(process.argv.slice(2));
  const result = await crawlLlmsDocs(inputUrl, options);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function parseArgs(argv: string[]) {
  if (argv.length === 0) {
    throw new Error("Usage: llms-crawl <url> [--max-retries N] [--base-delay-ms N] [--timeout-ms N]");
  }

  const [inputUrl, ...rest] = argv;

  if (!inputUrl) {
    throw new Error("Missing input URL.");
  }

  const options: {
    maxRetries?: number;
    baseDelayMs?: number;
    timeoutMs?: number;
  } = {};

  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    const value = rest[index + 1];

    if (!flag?.startsWith("--")) {
      throw new Error(`Unexpected argument: ${flag}`);
    }

    if (value === undefined) {
      throw new Error(`Missing value for ${flag}`);
    }

    const parsedValue = Number.parseInt(value, 10);

    if (!Number.isInteger(parsedValue) || parsedValue < 0) {
      throw new Error(`Invalid value for ${flag}: ${value}`);
    }

    switch (flag) {
      case "--max-retries":
        options.maxRetries = parsedValue;
        break;
      case "--base-delay-ms":
        options.baseDelayMs = parsedValue;
        break;
      case "--timeout-ms":
        options.timeoutMs = parsedValue;
        break;
      default:
        throw new Error(`Unknown flag: ${flag}`);
    }

    index += 1;
  }

  return { inputUrl, options };
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
