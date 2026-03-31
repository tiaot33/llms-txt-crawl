# llms-txt-crawl

抓取站点的 LLMS 文档及其继续引用的同域 `.md` / `.txt` 文档，并将成功结果保存到本地目录。

## 适用场景

- 你有一个站点入口 URL，想快速判断它是否提供 `llms.txt`
- 你已经拿到 `llms.txt` / `llms-full.txt` / `llms-small.txt`，想递归抓取关联文档
- 你需要把抓取结果落盘，供后续索引、清洗或离线处理

## 运行要求

- Node.js `20+`
- npm `11+` 或兼容版本

## 30 秒上手

安装依赖并构建：

```bash
npm install
npm run build
```

直接运行：

```bash
npm start -- "https://example.com/docs"
```

如果希望在本机直接使用 `llms-crawl` 命令：

```bash
npm link
llms-crawl "https://example.com/docs"
```

## 命令格式

```bash
llms-crawl <url> [--output-dir DIR] [--max-retries N] [--base-delay-ms N] [--timeout-ms N]
```

## 常见用法

从普通页面开始探测并抓取：

```bash
npm start -- "https://example.com/docs"
```

直接从已有 LLMS 文档开始：

```bash
npm start -- "https://example.com/llms.txt"
```

指定输出目录：

```bash
npm start -- "https://example.com/docs" --output-dir "./saved-docs"
```

调整重试与超时：

```bash
npm start -- "https://example.com/docs" --max-retries 5 --base-delay-ms 500 --timeout-ms 15000
```

## 参数说明

- `--output-dir`: 输出目录，默认 `./output/<host>`
- `--max-retries`: 对 `403`、`429`、`503` 的最大重试次数，默认 `3`
- `--base-delay-ms`: 指数退避基础等待时间，默认 `500`
- `--timeout-ms`: 单次请求超时时间，默认 `10000`

## 输出结果

程序会输出两类信息：

- `stderr`: 抓取进度、重试、完成状态
- `stdout`: 最终摘要和失败页面列表

默认输出目录示例：

```text
输入 URL: https://example.com/docs
输出目录: ./output/example.com
```

落盘示例：

```text
output/example.com/docs/llms.txt
output/example.com/docs/files/intro.md
output/example.com/files/overview.txt
```

摘要示例：

```text
success=3 failed=1 output="/abs/path/to/output/example.com"
failed-pages:
https://example.com/docs/missing.md
```

## 行为边界

- 仅支持 `http` / `https`
- 仅递归抓取同域 `.md` / `.txt` 文档
- 仅保存成功抓取的文档

## 开发

```bash
npm test
```
