import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { crawlLlmsDocs } from "../src/crawl.ts";
import {
  formatSummaryOutput,
  parseArgs,
  persistDocument,
  resolveOutputRoot,
} from "../src/cli-support.ts";

test("direct LLMS URL skips suffix probing", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const responses = new Map<string, Response>([
    [
      "https://example.com/llms.txt",
      new Response("[guide](./docs/intro.md)", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    ],
    [
      "https://example.com/docs/intro.md",
      new Response("done", {
        status: 200,
        headers: { "content-type": "text/plain" },
      }),
    ],
  ]);

  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);

    const response = responses.get(url);
    if (!response) {
      throw new Error(`Unexpected URL: ${url}`);
    }

    return response.clone();
  };

  try {
    const result = await crawlLlmsDocs("https://example.com/llms.txt");

    assert.equal(result.probes.length, 1);
    assert.equal(result.probes[0]?.probeType, "direct-seed");
    assert.equal(result.summary.documentsSucceeded, 2);
    assert.deepEqual(calls, [
      "https://example.com/llms.txt",
      "https://example.com/docs/intro.md",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("candidate probing finds LLMS docs and crawls same-host documents", async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  const responses = new Map<string, Response>([
    [
      "https://example.com/docs/llms.txt",
      new Response(
        [
          "[Intro](./files/intro.md)",
          "https://example.com/files/overview.txt",
          "https://other.example.com/files/ignored.md",
        ].join("\n"),
        { status: 200, headers: { "content-type": "text/plain" } },
      ),
    ],
    [
      "https://example.com/docs/llms-full.txt",
      new Response("Not found", { status: 404 }),
    ],
    [
      "https://example.com/docs/llms-small.txt",
      new Response("Not found", { status: 404 }),
    ],
    [
      "https://example.com/docs/files/intro.md",
      new Response("[Overview](https://example.com/files/overview.txt)", {
        status: 200,
        headers: { "content-type": "text/markdown" },
      }),
    ],
    [
      "https://example.com/files/overview.txt",
      new Response("done", { status: 200, headers: { "content-type": "text/plain" } }),
    ],
  ]);

  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);

    const response = responses.get(url);
    if (!response) {
      throw new Error(`Unexpected URL: ${url}`);
    }

    return response.clone();
  };

  try {
    const result = await crawlLlmsDocs("https://example.com/docs");

    assert.equal(result.probes.length, 3);
    assert.equal(result.summary.probesHit, 1);
    assert.equal(result.summary.documentsSucceeded, 3);
    assert.equal(result.summary.documentsFailed, 0);
    assert.equal(result.summary.documentsSkipped, 1);

    const documentUrls = result.documents.map((document) => document.url).sort();
    assert.deepEqual(documentUrls, [
      "https://example.com/docs/files/intro.md",
      "https://example.com/docs/llms.txt",
      "https://example.com/files/overview.txt",
      "https://other.example.com/files/ignored.md",
    ]);

    assert.ok(
      result.edges.some(
        (edge) =>
          edge.from === "https://example.com/docs/llms.txt" &&
          edge.to === "https://example.com/docs/files/intro.md",
      ),
    );

    assert.ok(
      result.edges.some(
        (edge) =>
          edge.from === "https://example.com/docs/llms.txt" &&
          edge.to === "https://example.com/files/overview.txt",
      ),
    );

    assert.deepEqual(calls.slice(0, 3), [
      "https://example.com/docs/llms.txt",
      "https://example.com/docs/llms-full.txt",
      "https://example.com/docs/llms-small.txt",
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("restricted responses use exponential backoff retries", async () => {
  const originalFetch = globalThis.fetch;
  let attempt = 0;

  globalThis.fetch = async () => {
    attempt += 1;

    if (attempt < 3) {
      return new Response("retry", { status: 429 });
    }

    return new Response("plain", {
      status: 200,
      headers: { "content-type": "text/plain" },
    });
  };

  try {
    const result = await crawlLlmsDocs("https://example.com/llms.txt", {
      baseDelayMs: 1,
      maxRetries: 3,
    });

    assert.equal(attempt, 3);
    assert.equal(result.documents[0]?.retries, 2);
    assert.equal(result.summary.restrictedRetries, 2);
    assert.equal(result.documents[0]?.status, "success");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("successful documents trigger onDocument with fetched content", async () => {
  const originalFetch = globalThis.fetch;
  const captured: Array<{ url: string; content: string; contentType?: string }> = [];

  globalThis.fetch = async () =>
    new Response("hello", {
      status: 200,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });

  try {
    const result = await crawlLlmsDocs("https://example.com/llms.txt", {
      onDocument: async (document) => {
        captured.push({
          url: document.url,
          content: document.content,
          contentType: document.contentType,
        });
      },
    });

    assert.equal(result.summary.documentsSucceeded, 1);
    assert.deepEqual(captured, [
      {
        url: "https://example.com/llms.txt",
        content: "hello",
        contentType: "text/plain; charset=utf-8",
      },
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("parseArgs supports output-dir and numeric options", () => {
  const parsed = parseArgs([
    "https://example.com/docs",
    "--output-dir",
    "./saved",
    "--max-retries",
    "5",
    "--timeout-ms",
    "2000",
  ]);

  assert.equal(parsed.inputUrl, "https://example.com/docs");
  assert.equal(parsed.outputDir, "./saved");
  assert.deepEqual(parsed.options, {
    maxRetries: 5,
    timeoutMs: 2000,
  });
});

test("resolveOutputRoot defaults to output hostname directory", () => {
  const outputRoot = resolveOutputRoot(
    "https://Example.com/docs",
    undefined,
    "/tmp/project",
  );

  assert.equal(outputRoot, path.resolve("/tmp/project", "output", "example.com"));
});

test("persistDocument stores content by URL path and query suffix", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "llms-crawl-"));
  const relativePath = await persistDocument(tempRoot, {
    url: "https://example.com/docs/intro.md?lang=zh&v=1",
    content: "# intro",
  });
  const savedFile = path.join(tempRoot, ...relativePath.split("/"));
  const savedContent = await readFile(savedFile, "utf8");

  assert.equal(relativePath, "docs/intro__lang-zh_v-1.md");
  assert.equal(savedContent, "# intro");
});

test("formatSummaryOutput prints summary and failed URLs only", () => {
  const output = formatSummaryOutput(
    {
      inputUrl: "https://example.com/docs",
      settings: {
        maxRetries: 3,
        baseDelayMs: 500,
        timeoutMs: 10000,
      },
      probes: [],
      documents: [
        {
          url: "https://example.com/docs/ok.md",
          status: "success",
          attempts: 1,
          retries: 0,
          discoveredLinks: [],
        },
        {
          url: "https://example.com/docs/bad.md",
          status: "failed",
          attempts: 1,
          retries: 0,
          discoveredLinks: [],
        },
        {
          url: "https://other.example.com/skip.md",
          status: "skipped",
          attempts: 0,
          retries: 0,
          skippedReason: "Cross-domain or unsupported document URL skipped.",
          discoveredLinks: [],
        },
      ],
      edges: [],
      summary: {
        seedsCount: 1,
        probesTotal: 1,
        probesHit: 1,
        documentsTotal: 3,
        documentsSucceeded: 1,
        documentsFailed: 1,
        documentsSkipped: 1,
        restrictedRetries: 0,
      },
    },
    "/tmp/output/example.com",
  );

  assert.equal(
    output,
    [
      'success=1 failed=1 output="/tmp/output/example.com"',
      "failed-pages:",
      "https://example.com/docs/bad.md",
      "",
    ].join("\n"),
  );
});
