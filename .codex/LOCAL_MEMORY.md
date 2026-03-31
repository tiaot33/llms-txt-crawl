# 项目本地记忆

## 硬约束

以下内容已经沉淀为长期规则，不在本文件重复展开，统一以 `.codex/AGENTS.md` 为准：

- CLI 输出与落盘契约：
  见 `CLI Output & Persistence Contract`。包括 `stderr` 进度日志、`stdout` 摘要格式、默认输出目录、成功文档落盘规则，以及 `failed` / `skipped` 不生成占位文件。
- 抓取器接口边界：
  见 `Crawl API Invariants`。包括 `CrawlOptions.onDocument` 的职责与载荷，以及 `CrawlResult` 不内嵌正文内容。
- 模块职责分层：
  见 `Change Boundaries`。抓取核心负责探测、重试和元数据结果；CLI 层负责参数解析、终端输出和文件持久化。

如果未来这些规则发生变化，先更新 `.codex/AGENTS.md`，再在本文件历史记录中追加变更背景，而不是在这里复制完整规范。

## 历史记录

### 2026-03-31

#### CLI 主产出从 stdout JSON 调整为落盘目录

- 项目确认工具的主产出应是保存到磁盘的文档目录，而不是面向机器消费的 `stdout` JSON。
- 因此引入 `--output-dir`，默认落盘到 `./output/<host>`，并将运行结束后的标准输出收敛为摘要与失败页面列表。
- 该决策已经沉淀为长期规则，当前以 `.codex/AGENTS.md` 中的 `CLI Output & Persistence Contract` 为准。

#### 文档持久化规则稳定

- 成功文档按 URL `pathname` 落盘，query 追加稳定后缀，避免相同路径覆盖。
- `failed` 与 `skipped` 不写占位文件，也不主动清理历史输出，避免工具越权删除用户已有结果。
- 这些行为已提升为长期约束，不再在本文件重复维护细节。

#### 抓取器结果对象与正文解耦

- 为支持抓取成功后即时落盘，`CrawlOptions` 增加了 `onDocument` 回调。
- 同时保留 `CrawlResult` 只承载元数据，不直接携带正文内容，避免结果对象膨胀和 CLI 层职责回流。
- 相关约束已纳入 `.codex/AGENTS.md` 的 `Crawl API Invariants`。
