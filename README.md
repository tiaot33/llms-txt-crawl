# llms-txt-crawl

Probe and recursively crawl [llms.txt](https://llmstxt.org/) documents from any website, saving all linked `.md` / `.txt` files to a local directory.

## Features

- Auto-detect `llms.txt` / `llms-full.txt` / `llms-small.txt` from any site URL
- Recursively crawl same-host `.md` / `.txt` documents referenced in the entry file
- Exponential backoff retries for `403`, `429`, `503` responses
- Zero config — just give it a URL

## Quick Start

```bash
npx llms-txt-crawl "https://docs.anthropic.com"
```

That's it. Documents are saved to `./output/<hostname>/` by default.

## Install

```bash
# Global install
npm install -g llms-txt-crawl

# Then use directly
llms-txt-crawl "https://docs.anthropic.com"
```

## Usage

```bash
npx llms-txt-crawl <url> [options]
```

### Options

| Option | Default | Description |
|---|---|---|
| `--output-dir <dir>` | `./output/<host>` | Output directory |
| `--max-retries <n>` | `3` | Max retries for 403/429/503 |
| `--base-delay-ms <n>` | `500` | Exponential backoff base delay |
| `--timeout-ms <n>` | `10000` | Request timeout per fetch |

### Examples

Crawl from a site URL (auto-probes for llms.txt):

```bash
npx llms-txt-crawl "https://example.com/docs"
```

Start directly from an llms.txt file:

```bash
npx llms-txt-crawl "https://example.com/llms.txt"
```

Custom output directory with retry tuning:

```bash
npx llms-txt-crawl "https://example.com/docs" \
  --output-dir "./saved-docs" \
  --max-retries 5 \
  --timeout-ms 15000
```

## Output

### Directory structure

```
output/example.com/
  llms.txt
  docs/
    intro.md
    api/
      overview.txt
```

### Console output

Progress and status are written to `stderr`:

```
[llms-txt-crawl] start https://example.com/llms.txt
[llms-txt-crawl] probe https://example.com/llms.txt
[llms-txt-crawl] crawl https://example.com/docs/intro.md
[llms-txt-crawl] done success=3 failed=0 skipped=0
```

Summary is written to `stdout`:

```
success=3 failed=1 output="./output/example.com"
failed-pages:
https://example.com/docs/missing.md
```

## How It Works

1. If the input URL points directly to an `llms.txt` / `llms-full.txt` / `llms-small.txt`, skip probing
2. Otherwise, probe the site by appending each candidate filename to the URL path
3. For each discovered entry file, parse links to `.md` / `.txt` documents
4. Recursively crawl all same-host document links
5. Save every successfully fetched document to the output directory

## Requirements

- Node.js >= 20

## License

MIT
