import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { crawlLlmsDocs } from "../src/crawl.ts";
import { main } from "../src/cli.ts";

function captureProcessOutput() {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const originalStdoutWrite = process.stdout.write;
  const originalStderrWrite = process.stderr.write;

  process.stdout.write = ((chunk, encoding, callback) => {
    stdoutChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
    if (typeof encoding === "function") {
      encoding();
    }
    if (typeof callback === "function") {
      callback();
    }
    return true;
  }) as typeof process.stdout.write;

  process.stderr.write = ((chunk, encoding, callback) => {
    stderrChunks.push(typeof chunk === "string" ? chunk : chunk.toString());
    if (typeof encoding === "function") {
      encoding();
    }
    if (typeof callback === "function") {
      callback();
    }
    return true;
  }) as typeof process.stderr.write;

  return {
    restore() {
      process.stdout.write = originalStdoutWrite;
      process.stderr.write = originalStderrWrite;
    },
    stdout: stdoutChunks,
    stderr: stderrChunks,
  };
}

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

test("main writes crawled documents and summary output", async () => {
  const originalFetch = globalThis.fetch;
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "llms-txt-crawl-"));
  const output = captureProcessOutput();

  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.toString();

    switch (url) {
      case "https://example.com/llms.txt":
        return new Response("[Intro](./docs/intro.md?lang=zh&v=1)", {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      case "https://example.com/docs/intro.md?lang=zh&v=1":
        return new Response("# intro", {
          status: 200,
          headers: { "content-type": "text/markdown" },
        });
      default:
        throw new Error(`Unexpected URL: ${url}`);
    }
  };

  try {
    await main([
      "https://example.com/llms.txt",
      "--output-dir",
      tempRoot,
      "--max-retries",
      "5",
      "--timeout-ms",
      "2000",
    ]);

    const llmsContent = await readFile(path.join(tempRoot, "llms.txt"), "utf8");
    const introContent = await readFile(
      path.join(tempRoot, "docs", "intro__lang-zh_v-1.md"),
      "utf8",
    );

    assert.equal(llmsContent, "[Intro](./docs/intro.md?lang=zh&v=1)");
    assert.equal(introContent, "# intro");
    assert.equal(
      output.stdout.join(""),
      `success=2 failed=0 output="${tempRoot}"\n`,
    );
    assert.match(output.stderr.join(""), /\[llms-txt-crawl\] start https:\/\/example\.com\/llms\.txt/);
    assert.match(
      output.stderr.join(""),
      /\[llms-txt-crawl\] done success=2 failed=0 skipped=0/,
    );
  } finally {
    output.restore();
    globalThis.fetch = originalFetch;
  }
});

test("main prints failed document URLs in summary", async () => {
  const originalFetch = globalThis.fetch;
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "llms-txt-crawl-"));
  const output = captureProcessOutput();

  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.toString();

    switch (url) {
      case "https://example.com/llms.txt":
        return new Response("[Broken](./docs/bad.md)", {
          status: 200,
          headers: { "content-type": "text/plain" },
        });
      case "https://example.com/docs/bad.md":
        return new Response("nope", { status: 500 });
      default:
        throw new Error(`Unexpected URL: ${url}`);
    }
  };

  try {
    await main(["https://example.com/llms.txt", "--output-dir", tempRoot]);

    assert.equal(await readFile(path.join(tempRoot, "llms.txt"), "utf8"), "[Broken](./docs/bad.md)");
    await assert.rejects(() => readFile(path.join(tempRoot, "docs", "bad.md"), "utf8"));
    assert.equal(
      output.stdout.join(""),
      [
        `success=1 failed=1 output="${tempRoot}"`,
        "failed-pages:",
        "https://example.com/docs/bad.md",
        "",
      ].join("\n"),
    );
  } finally {
    output.restore();
    globalThis.fetch = originalFetch;
  }
});
