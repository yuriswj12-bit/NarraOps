# NarraOps X Account Monitor

监控固定 X 账号，把推文规范化成 Pulse 叙事卡，推送到 NarraOps 的
`pulse-narrative-ingest` Edge Function。入库后 Pulse 卡片和 Go Agent 流式聊天
会**实时**看到这些数据（Agent 每次查询 `pulse_narrative_candidates` 表）。

## 数据流

```
X 公开主页 ── Playwright ──> 规范化卡片 ── POST ──> pulse-narrative-ingest
                                                        │
                                                pulse_narrative_candidates 表
                                                        │
                                        Pulse 卡片 / Go Agent 流式聊天（实时）
```

## 1. 部署 ingest Edge Function（一次性）

在 Supabase 部署 `supabase/functions/pulse-narrative-ingest`：

```bash
npx supabase functions deploy pulse-narrative-ingest
npx supabase secrets set PULSE_NARRATIVE_COLLECTOR_SECRET=<你的secret>
```

`SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` 在 Supabase 项目里默认可用。
部署完成后拿到函数 URL：
`https://<project-ref>.supabase.co/functions/v1/pulse-narrative-ingest`

## 2. 配置监控脚本

```bash
cd scripts/x-account-monitor
npm install            # 装 playwright
npx playwright install chromium   # 装浏览器内核
cp config.example.json config.json
```

编辑 `config.json`：

- `accounts`：填你要盯的固定账号 `handle`（不要 `@`），可给 `category_hint`
  和 `priority`。`enabled: false` 会跳过。
- `ingest.url`：上面部署得到的函数 URL。
- `ingest.secret`：要么填在配置（仅本地开发），要么用环境变量
  `PULSE_NARRATIVE_COLLECTOR_SECRET`（推荐，避免明文入库）。
- `cookie.enabled` / `cookie.path`：X 未登录有登录墙，可能只能拿到少量推文。
  可选：把浏览器导出的 X cookie（JSON 数组，Playwright 格式）放到本地文件
  `cookies.json`，开启 `cookie.enabled`。**cookie 文件不入仓库**（已在
  `.gitignore` 忽略）。

## 3. 运行

```bash
node monitor.mjs --once      # 跑一轮就退出（手动验证）
node monitor.mjs             # 按 pollMinutes 循环
```

建议用 cron / 计划任务每 5–15 分钟跑一次 `--once`，或在常驻机器上跑循环模式。

## 4. 验证

- 脚本日志会打印每账号采集条数、`ingest` 返回的 `accepted / inserted / rejected`。
- 打开 Pulse 页看对应类别是否出现监控账号的叙事卡。
- 在 Go 发"有哪些叙事"或"看看有什么热点"，Agent 会实时返回这些叙事。

## 说明与限制

- **X 登录墙**：未登录时公开主页只渲染少量推文。要盯的账号多/要拿全，
  建议使用本机已登录 X 的 cookie。
- **DOM 选择器**：基于 `data-testid="tweet"` / `tweetText` 等属性，X 改版可能
  需要调整 `collectAccount` / `extractTweet`。
- **过滤**：脚本侧已丢回复/转帖；NarraOps 侧（ingest）再挡非 x.com 链接、
  空正文、超 4 小时窗口。软文/天气/财报类暂不特殊过滤，可在
  `routeCategory` 或脚本里按需加黑名单。
- 同一推文重复运行不会重复入库（`narrative_id` 由内容指纹决定，upsert
  on conflict）。