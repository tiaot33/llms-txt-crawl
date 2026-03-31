# llms-txt-crawl

探测并递归抓取网站的 [llms.txt](https://llmstxt.org/) 文档，将所有关联的 `.md` / `.txt` 文件保存到本地目录。

## 特性

- 自动探测站点的 `llms.txt` / `llms-full.txt` / `llms-small.txt` 入口
- 递归抓取同域下所有被引用的 `.md` / `.txt` 文档
- 指数退避重试策略，应对 `403`、`429`、`503` 限流
- 零配置 — 只需要一个 URL

## 30 秒上手

```bash
npx llms-txt-crawl "https://docs.anthropic.com"
```

文档默认保存到 `./output/<hostname>/` 目录。

## 安装

```bash
# 全局安装
npm install -g llms-txt-crawl

# 直接使用
llms-txt-crawl "https://docs.anthropic.com"
```

## 使用方式

```bash
npx llms-txt-crawl <url> [选项]
```

### 参数说明

| 参数 | 默认值 | 说明 |
|---|---|---|
| `--output-dir <dir>` | `./output/<host>` | 输出目录 |
| `--max-retries <n>` | `3` | 对 403/429/503 的最大重试次数 |
| `--base-delay-ms <n>` | `500` | 指数退避基础等待时间（毫秒） |
| `--timeout-ms <n>` | `10000` | 单次请求超时时间（毫秒） |

### 常见用法

从站点 URL 开始（自动探测 llms.txt）：

```bash
npx llms-txt-crawl "https://example.com/docs"
```

直接从 llms.txt 文件开始：

```bash
npx llms-txt-crawl "https://example.com/llms.txt"
```

自定义输出目录和重试参数：

```bash
npx llms-txt-crawl "https://example.com/docs" \
  --output-dir "./saved-docs" \
  --max-retries 5 \
  --timeout-ms 15000
```

## 输出结果

### 目录结构

```
output/example.com/
  llms.txt
  docs/
    intro.md
    api/
      overview.txt
```

### 控制台输出

进度信息输出到 `stderr`：

```
[llms-txt-crawl] start https://example.com/llms.txt
[llms-txt-crawl] probe https://example.com/llms.txt
[llms-txt-crawl] crawl https://example.com/docs/intro.md
[llms-txt-crawl] done success=3 failed=0 skipped=0
```

摘要信息输出到 `stdout`：

```
success=3 failed=1 output="./output/example.com"
failed-pages:
https://example.com/docs/missing.md
```

## 工作原理

1. 如果输入 URL 直接指向 `llms.txt` / `llms-full.txt` / `llms-small.txt`，跳过探测
2. 否则，依次在 URL 路径后追加候选文件名进行探测
3. 解析入口文件中引用的 `.md` / `.txt` 文档链接
4. 递归抓取所有同域文档链接
5. 将每个成功获取的文档保存到输出目录

## 环境要求

- Node.js >= 20

## 许可证

MIT
