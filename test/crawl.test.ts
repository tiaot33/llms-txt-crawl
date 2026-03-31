import test from "node:test";
import assert from "node:assert/strict";

import { crawlLlmsDocs } from "../src/crawl.ts";

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
