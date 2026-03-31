# llms-txt-crawl

一个使用 TypeScript 编写的命令行工具，用于探测站点是否提供 LLMS 友好文档，并递归抓取这些文档中继续引用的 `.md` / `.txt` 文件。

## 功能特性

- 探测输入 URL 对应的 `llms.txt`、`llms-full.txt`、`llms-small.txt`
- 如果输入本身已经是上述 LLMS 文档之一，则直接以该文档作为递归入口
- 递归解析 Markdown 内联链接、参考式链接、自动链接和裸文本 URL
- 仅跟进与起始 URL 同域名的 `.md` / `.txt` 文档
- 对 `403`、`429`、`503` 响应执行指数级退避重试
- 输出结构化 JSON，便于后续脚本消费

## 运行要求

- Node.js `20+`
- npm `11+` 或兼容版本

## 安装依赖

```bash
npm install
```

## 构建

```bash
npm run build
```

## 命令行用法

```bash
llms-crawl <url> [--max-retries N] [--base-delay-ms N] [--timeout-ms N]
```

也可以在未全局安装时直接通过本地脚本运行：

```bash
node "./dist/cli.js" "https://example.com/docs"
```

### 参数说明

- `--max-retries`
  - 访问受限时的最大重试次数，默认 `3`
- `--base-delay-ms`
  - 指数退避的基础等待时间，默认 `500`
- `--timeout-ms`
  - 单次请求超时时间，默认 `10000`

### 示例

探测普通站点 URL：

```bash
node "./dist/cli.js" "https://example.com/docs"
```

直接从已有的 LLMS 文档开始：

```bash
node "./dist/cli.js" "https://example.com/llms.txt"
```

自定义重试参数：

```bash
node "./dist/cli.js" "https://example.com/docs" --max-retries 5 --base-delay-ms 500 --timeout-ms 15000
```

## 输出结构

程序会向标准输出打印 JSON，大致包含以下字段：

- `inputUrl`
  - 用户输入并规范化后的 URL
- `settings`
  - 当前使用的重试和超时配置
- `probes`
  - LLMS 文档探测结果
- `documents`
  - 成功、失败或跳过的文档节点
- `edges`
  - 文档之间的来源关系
- `summary`
  - 汇总统计信息

输出示例：

```json
{
  "inputUrl": "https://example.com/docs",
  "settings": {
    "maxRetries": 3,
    "baseDelayMs": 500,
    "timeoutMs": 10000
  },
  "probes": [],
  "documents": [],
  "edges": [],
  "summary": {
    "seedsCount": 0,
    "probesTotal": 0,
    "probesHit": 0,
    "documentsTotal": 0,
    "documentsSucceeded": 0,
    "documentsFailed": 0,
    "documentsSkipped": 0,
    "restrictedRetries": 0
  }
}
```

## 重试策略

当请求返回 `403`、`429`、`503` 时，工具会使用指数级退避重试：

- 第 1 次重试等待 `500ms`
- 第 2 次重试等待 `1000ms`
- 第 3 次重试等待 `2000ms`

实际等待时间由 `baseDelayMs * 2^(retryIndex - 1)` 计算。

## 开发

运行测试：

```bash
npm test
```

当前测试覆盖：

- 直接输入 LLMS 文档 URL 时跳过追加后缀探测
- 普通 URL 的 LLMS 文件探测与同域递归抓取
- 访问受限时的指数级退避重试

## 当前边界

- 只支持 `http` / `https`
- 只递归 `.md` 和 `.txt` 文档
- 默认只跟进同域名链接，不跨域扩散
- 输出仅包含元数据，不包含文档正文
