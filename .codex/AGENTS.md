# Repository Guidelines

## Project Structure & Module Organization
核心源码位于 `src/`。`src/cli.ts` 负责命令行入口与进度输出，`src/crawl.ts` 实现探测、重试和递归抓取流程，`src/cli-support.ts` 负责参数解析、输出目录解析与文档持久化，公共类型集中在 `src/types.ts`。测试位于 `test/`，当前以 `test/crawl.test.ts` 覆盖抓取主路径和 CLI 辅助逻辑。`dist/` 是构建产物，`output/` 是运行期抓取结果，二者都不应手工维护。

## Build, Test, and Development Commands
要求 Node.js 20+。

- `npm install`：安装 TypeScript 与 Node 类型定义。
- `npm run build`：将 `src/**/*.ts` 编译到 `dist/`，并为 `dist/cli.js` 添加可执行权限。
- `npm test`：使用 Node 内置测试运行器执行 `test/**/*.test.ts`。
- `npm start -- "https://example.com/docs"`：运行已构建的 CLI。

本地验证推荐先构建，再执行 `./dist/cli.js "https://example.com/docs" --output-dir "./output/dev"`。

## Coding Style & Naming Conventions
项目使用严格模式 TypeScript、ESM 和 2 空格缩进。优先保持函数职责单一，CLI 侧负责 I/O 与持久化，抓取核心保持纯业务流程。变量和函数使用 `camelCase`，类型与接口使用 `PascalCase`，常量使用 `UPPER_SNAKE_CASE`。本地模块导入统一使用 `.js` 扩展名，以匹配 NodeNext 编译输出。

## CLI Output & Persistence Contract
该工具的主产出是落盘后的文档目录，不是 `stdout` JSON。进度日志必须写入 `stderr`；运行结束后，`stdout` 仅输出摘要和失败页面列表，格式保持 `success=<n> failed=<n> output="<dir>"`，必要时追加 `failed-pages:` 段。默认输出目录是 `./output/<host>`，也支持 `--output-dir` 覆盖。仅成功抓取的文档会保存，保存路径按 URL `pathname` 还原；带 query 的 URL 需要在扩展名前追加稳定后缀。`failed` 和 `skipped` 不生成占位文件，也不主动清理历史输出。

## Testing Guidelines
测试使用 `node:test` 与 `node:assert/strict`。新增测试文件命名为 `*.test.ts` 并放在 `test/` 下。修改抓取、重试、参数解析或落盘行为时，必须补充针对性测试，尤其覆盖同域递归、受限状态码重试、输出摘要格式和 query 文件名映射。优先 mock `globalThis.fetch`，避免真实网络依赖。提交前至少本地执行一次 `npm test`，不要只依赖静态阅读判断行为正确。

## Crawl API Invariants
`CrawlOptions.onDocument` 用于在成功抓取正文后即时持久化，回调载荷应包含 `url`、可选 `sourceUrl`、`content` 和可选 `contentType`。`CrawlResult` 保持元数据结果，不应内嵌正文内容。若修改这些接口，同时更新测试与 `README.md`，避免 CLI 层与抓取层契约漂移。

## Change Boundaries
除非需求明确变化，否则不要把抓取器重新耦合到 CLI 输出格式上，也不要把正文内容重新塞回结果对象。`src/crawl.ts` 的职责是探测、抓取、重试和返回元数据；参数解析、终端输出和文件落盘应继续留在 CLI 相关模块中。涉及默认重试次数、超时或输出目录规则的改动时，先同步检查测试、README 示例和摘要输出是否仍一致。

## Commit & Pull Request Guidelines
提交信息延续当前历史风格，优先使用简短祈使句，功能变更建议使用 Conventional Commits，例如 `feat: add llms crawler CLI and project documentation`。PR 应包含变更摘要、验证命令结果（至少 `npm run build` 和 `npm test`），以及任何影响 CLI 输出或落盘结构的示例。
