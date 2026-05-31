# API 服务 + 独立 Worker + pi-coding-agent SDK + 持久化事件流

技术栈：

- 后端 API：Node.js 24 + TypeScript + Hono
- 任务数据库：better-sqlite3
- 后台任务：独立 worker 进程，API 只负责任务创建、查询、订阅
- 消息流：
  - 持久化表 `task_events`
  - 实时订阅用 SSE
  - 客户端用 `Last-Event-ID` 恢复历史
- 文件存储：本地目录 `data/tasks/<taskId>/`
- Agent 执行：用 `@earendil-works/pi-coding-agent` SDK
  - 该包属于 worker 运行时依赖，应放在 `dependencies`
  - `@earendil-works/pi-agent-core` 作为底层 agent 依赖保留
- API 形态：
  - `GET /tasks` 获取搜索任务列表
  - `POST /tasks` 创建搜索任务
  - `GET /tasks/:id` 查询状态
  - `GET /tasks/:id/events` SSE 订阅历史 + 实时事件
  - `GET /tasks/:id/files` 获取产物文件列表
  - `GET /tasks/:id/files/:fileId` 下载文件

核心设计上，把 agent 执行隔离成 worker，而不是直接在 HTTP handler 里跑。药物检索会访问网络、下载 PDF、调用模型、写大量文件，耗时长且容易失败；worker 隔离后，API 服务更稳定，也更容易做重试、取消、并发限制和审计。
如果任务因为网络、用户手动暂停、LLM API 暂时不可用等原因中断，支持“继续执行”。继续执行时复用任务目录和 pi session 历史，让 agent 根据已有上下文继续完成原任务。

任务目录可以这样定：

```txt
data/
  tasks/
    <taskId>/
      workdir/
      output/
        <drug-slug>_research_report.md
        <drug-slug>_data.json
        sources_index.md
        sources/
        images/
      session/
```

事件表建议至少有：

```txt
task_events
- id
- task_id
- seq               task 内递增序号，用作 SSE event id
- type
- message
- payload_json
- created_at
```

SSE 订阅规则：

- 首次订阅返回该任务全部历史事件，然后继续推送实时事件。
- 如果请求带 `Last-Event-ID`，只返回 `seq > Last-Event-ID` 的事件，再继续推送实时事件。
- `task_events.seq` 必须在同一个 `task_id` 内单调递增。

任务表：

```txt
tasks
- id
- status: queued | running | paused | succeeded | failed | cancelled
- input_json
- output_dir
- error_message
- locked_by
- locked_until
- attempt_count
- failure_retryable
- created_at
- started_at
- finished_at
```

Worker 领取任务：

- Worker 只自动领取 `queued`、锁过期且未超出重试上限的 `running`，以及标记为可重试且未超出重试上限的 `failed` 任务。
- `failed` 不再默认无限自动重跑；产物校验失败等确定性错误会标记为不可自动重试。
- `paused` 只在用户显式继续后回到 `queued`。
- `cancelled` 是终态，不会被自动领取，也不会被继续。
- 领取时写入 `locked_by` 和 `locked_until`，避免多个 worker 同时执行同一任务。
- 执行中定期刷新 `locked_until`。
- 如果 worker 异常退出，锁过期后任务可以被重新领取。
- 重新领取时基于原 `output_dir` 和 session 历史继续执行，不创建新的任务目录。

落地：

1. API 收到任务后写入 `tasks`，状态为 `queued`。
2. Worker 领取任务，创建独立 workdir。
3. Worker 用 `pi-coding-agent` 创建 session，加载 `.agents/skills/drug-evidence-research`。
4. 构造 prompt，例如让 agent 使用该 skill，对指定药物执行检索，并把产物保存到指定目录。
5. 监听 `AgentSession.subscribe()` 事件，把 assistant/tool/bash/file 进度转成 `task_events`。
6. ~~完成后扫描 output 目录，把文件索引写入数据库。~~ 文件列表不用入库，文件相关 API `/tasks/:id/files*` 直接对目录进行读取和操作。
7. 下载 API 只允许访问该任务目录下的白名单文件，避免路径穿越。

文件 API 约束：

- 只允许读取 `data/tasks/<taskId>/output/` 下的文件。
- `fileId` 可以是 output 目录下的相对路径编码值。
- 下载前必须解析真实路径，并确认真实路径仍在该任务的 output 目录内。
- 不允许下载 `workdir/`、`session/`、环境变量文件、配置文件或数据库文件。
