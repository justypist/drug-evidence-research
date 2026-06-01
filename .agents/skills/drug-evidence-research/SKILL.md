---
name: drug-evidence-research
description: Systematic public evidence research workflow for drug candidates, code names, biologics, peptides, small molecules, and company assets. Use when Codex needs to search, verify, archive, and summarize all available public clinical, preclinical, animal, regulatory, publication, conference, company, and trial-registry data for a compound, then save a local report and structured dataset.
---

# Drug Evidence Research

## 目标

针对任意药物代号、通用名或项目名，系统检索并归档公开资料，输出可追溯报告和结构化数据。重点区分已确认数据、公司计划、类比/比较药数据、未公开数据和检索未发现的数据。

优先回答：

- 当前临床阶段是什么？
- 是否有 Phase 1/2/3 登记和结果？
- 临床前、动物、PK、毒理数据有哪些？
- 哪些数据只是公司计划，哪些已经完成？
- 哪些重要数据尚未公开或未检索到？

## 工作流

1. 如请求涉及当前状态、最新进展或时效性结论，先用 `date` 确认当前日期时间。
2. 创建输出目录 `<drug>_research/`，其中包含 `sources/`，必要时包含 `images/`。
3. 记录检索日期、药物名称、已知公司、靶点和适应症。
4. 使用精确名称和变体名称广泛检索。
5. 默认按 [parallel_retrieval.md](references/parallel_retrieval.md) 并行获取独立来源；只有发现新 ID/文件名/标题后的反查进入下一轮。
6. 优先使用注册库、论文、公司原始材料、监管数据库、SEC/EDGAR、会议资料等原始来源。
7. 若可能存在 PDF/PPT/DOC/XLS、poster、slide deck、abstract book、supplement，必须执行 [document_retrieval.md](references/document_retrieval.md)。
8. 按固定检索矩阵和模板执行，保存 `query_log.tsv`；归档通过校验的原文、HTML、API JSON、PDF 文本和必要截图。
9. 抽取事实并按证据类型分类，记录 negative search；401/403/404/5xx 或错误页只记录失败。
10. 保存最终产物：
   - `<DRUG>_research_report.md`
   - `<drug>_data.json`
   - `query_log.tsv`
   - `document_candidates.tsv`（如执行文档检索）
   - `sources_index.md`
   - raw files under `sources/`

## 稳定性与可复现性

每次研究必须采用同一套基础流程；只有在发现新别名、登记号、公司名、靶点或会议名后，才追加扩展检索。

- 固定顺序：名称归一化 -> 注册库 -> PubMed/论文 -> 公司官网/投资者材料 -> SEC/监管 -> 会议资料 -> 专利/结构线索 -> 通用网络检索 -> 媒体/视频。
- 固定并行：同一波次内独立来源并行执行，波次之间按依赖推进；最终日志排序合并。
- 固定记录：`query_log.tsv` 至少包含 `date`、`source`、`query`、`result_count_or_status`、`urls_reviewed`、`notes`。
- 固定去重：按 canonical URL、DOI、NCT/登记号、SEC accession、PDF 文件名/标题去重；同一来源不同版本保留最新版，同时记录旧版线索。
- 固定覆盖：不要因找到一篇公司新闻或一个注册试验就停止；完成“完成前检查”中的来源覆盖后再总结。
- 固定抽取：每个关键事实必须带 `source_file` 或 URL；无法回溯到来源的事实降级为 `unverified_note` 或不写入结论。
- 固定输出：无命中也要在 `not_found` 和 `query_log.tsv` 记录来源和查询式。

建议每类来源至少审阅以下数量，除非结果总数不足：

- 注册库：所有精确名称/别名命中，至少审阅前 20 条 API/搜索结果。
- PubMed/Crossref/Scholar 线索：每个核心查询至少审阅前 20 条；所有标题含精确代号、INN、靶点+公司组合的结果必须打开核验。
- 公司和 SEC：至少覆盖官网 pipeline、press release、events/presentations、annual/quarterly filings、investor deck；通用网络检索每个核心查询至少审阅前 10 条非广告结果。
- 文档检索：对公司/会议/投资者 HTML 运行 `scripts/drug_doc_links`，审阅目标相关 PDF/PPT/DOC/XLS。

## 名称变体

至少检索：

- 精确代号：`"PN-881"`
- 去连字符：`PN881`
- 公司 + 代号：`Protagonist PN-881`
- 代号 + 靶点：`PN-881 IL-17`
- 代号 + 阶段：`PN-881 Phase 1`、`PN-881 Phase 2`
- 代号 + 数据类型：`preclinical`、`animal`、`mouse`、`rat`、`PK`、`toxicology`、`IC50`
- 代号 + 结果词：`results`、`data`、`poster`、`abstract`、`presentation`、`dose`、`safety`、`pharmacokinetics`
- 代号 + 监管/财务词：`IND`、`CTA`、`FDA`、`EMA`、`10-K`、`10-Q`、`8-K`、`S-1`、`424B`
- 代号 + 来源限定：`site:clinicaltrials.gov`、`site:pubmed.ncbi.nlm.nih.gov`、`site:sec.gov`、`site:<company-domain>`
- 代号 + 登记号/内部编号，发现后反向检索。

如药物有 INN、商品名、旧名、合作方编号，加入同一轮检索，并在报告中说明同义关系。

固定查询模板：

```text
"<alias>"
"<alias>" <developer>
"<alias>" <target>
"<alias>" Phase 1
"<alias>" Phase 2
"<alias>" clinical trial
"<alias>" results
"<alias>" preclinical OR animal OR mouse OR rat
"<alias>" PK OR pharmacokinetics OR toxicology
"<alias>" poster OR abstract OR presentation
"<alias>" IND OR CTA OR FDA OR EMA
"<developer>" "<alias>" 10-K OR 10-Q OR 8-K OR S-1 OR 424B
```

对每个确认别名至少跑上述模板；发现登记号、论文题名、会议题名、专利号、内部 study ID 后，用该 ID/题名再反向检索一轮。

## 来源优先级

### 临床注册

- ClinicalTrials.gov 网页和 API：
  - `https://clinicaltrials.gov/api/v2/studies/<NCT_ID>`
  - `https://clinicaltrials.gov/api/v2/studies?query.term=<TERM>&format=json`
- EU Clinical Trials Register / CTIS
- WHO ICTRP
- 中国药物临床试验登记与信息公示平台
- ANZCTR、日本 jRCT 等地区注册库
- 第三方聚合站只作线索，尽量回到原始注册库。

### 论文与摘要

- PubMed API：
  - `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=<QUERY>&retmode=json`
- Crossref、Google Scholar、publisher 页面
- 会议官网 abstract book、poster PDF、oral presentation PDF

### 公司与监管

- 公司官网：pipeline、press releases、events/presentations、scientific posters
- SEC EDGAR：10-K、10-Q、8-K、S-1/F-1、20-F/6-K、424B、exhibit investor deck
- FDA/EMA：批准、标签、审评文件、孤儿药/快速通道等资格
- 专利只在需要化学结构、序列、先导物或 IP 边界时检索；报告中明确专利信息不等于临床证据。

### 会议与灰色文献

- 医学/科学会议：官网摘要库、abstract book、poster PDF、oral slide、late-breaking supplement。
- 投资者会议：webcast、transcript、slide deck、SEC exhibit。
- 预印本和机构库：bioRxiv、medRxiv、Europe PMC、大学/公司资料页。
- 新闻稿转载、数据库卡片、行业媒体仅作线索；必须尝试追溯到原始 PDF、注册库、公司页面或 SEC 文件。

## 归档规范

保存原文或机器可读版本：

- PDF: `curl -L --fail --show-error -o sources/<date_or_source>_<title>.pdf <url>`
- PPT/DOC/XLS: 按 [document_retrieval.md](references/document_retrieval.md) 下载、校验、转文本或记录元数据。
- HTML: `curl -L --fail --show-error -o sources/<date_or_source>_<title>.html <url>`
- API JSON: `curl -L --fail --show-error -o sources/<name>.json <url>`
- 视频/音频页面：优先使用 `yt-dlp` skill 下载视频、音频或 metadata JSON；需要转码、抽音频、裁剪片段、截关键帧时使用 `ffmpeg` skill。
- PDF 文本：`pdftotext -layout input.pdf output.txt`
- HTML 文本：可用 Python `html.parser` 提取到 `.txt`
- 图表截图：当 PDF 文本缺失剂量、坐标轴、统计标记时，用 `pdftoppm` 转关键页到 `images/`

### 下载与错误页过滤

下载前后都要校验。不要把访问失败页、登录页、WAF/Cloudflare 阻断页、空白页、搜索结果页伪装成来源保存。

- 下载前先取 HTTP 状态和 content type；401、403、404、410、429、5xx 直接记入 `sources_index.md` 的失败记录，不创建 source 文件。
- `curl` 必须使用 `--fail --location --show-error`；需要状态码时用 `curl -L -I` 或 `curl -L -w "%{http_code} %{content_type} %{url_effective}\n" -o <tmp> <url>`。
- 只把 2xx 成功且内容类型合理的文件移动到 `sources/`；3xx 最终落到有效 2xx 页面才可保存。
- 下载后检查文件大小和内容特征：HTML 小于 1 KB、PDF 小于 5 KB、或文本含 `404 Not Found`、`403 Forbidden`、`401 Unauthorized`、`Access Denied`、`not authorized`、`Page not found`、`Please enable JavaScript`、`captcha`、`Cloudflare`、`Akamai`、`login` 等错误/阻断信号时，不作为证据保存。
- 若已下载到临时文件但判定为错误页，删除临时文件；在 `sources_index.md` 记录 URL、状态码、content type、失败原因和尝试日期。
- 对 PDF 用 `file` 或 `pdfinfo` 初筛；不是 PDF 或无法解析时，不要按 PDF 证据归档。
- 对 HTML 提取正文后再判断是否包含目标药物/公司/登记号等核心词；没有核心词且不是索引页/目录页时，只作线索或失败记录。
- 浏览器兜底得到的截图或 PDF 同样必须确认页面不是错误、登录、验证码或访问阻断页面；否则只记录失败，不保存到 `sources/`。

`sources_index.md` 对失败访问使用固定行格式：

```markdown
- FAILED | <status/content-type> | <url> | <reason> | tried: <curl/browser/api> | <YYYY-MM-DD>
```

若 `curl`、`wget` 或 API 请求因浏览器限定、访问阻断、JavaScript 渲染等原因无法下载或读取来源：

- 优先使用 `agent-browser` skill，并通过 `agent-browser` CLI 打开页面、抽取可见文本、保存 PDF 或截图。
- 将可保存的浏览器产物归档到 `sources/` 或 `images/`，并在 `sources_index.md` 记录 URL、访问日期、使用的 `agent-browser` 命令和本地文件。
- 如果浏览器兜底仍失败，或页面是 401/403/404/登录/验证码/阻断页，在 `sources_index.md` 记录 URL、失败原因和已尝试方法，不保存页面文件。

若证据来源是公司 webcast、会议录像、访谈、YouTube/Vimeo/X/Twitter/其他视频平台：

- 使用 `yt-dlp` skill 读取实际用法，先保存 metadata JSON 或 info 输出，再按需要下载视频或抽取音频。
- 使用 `ffmpeg` skill 生成可检索音频、裁剪相关片段、截取含关键数据的画面到 `images/`。
- 不要把口头计划或访谈表述自动当作已完成数据；按 `planned`、`confirmed` 或 `not_found` 分类，并在报告中注明时间戳、说话场景和来源文件。
- 在 `sources_index.md` 记录原始 URL、下载命令、媒体文件、metadata、音频/截图/片段文件和无法下载原因。

## 信息抽取清单

### Compound

- 名称、别名、开发方、合作方、资产归属
- 类型：小分子、抗体、肽、核酸、细胞疗法等
- 靶点、机制、给药途径、剂型
- 适应症
- 开发候选物提名时间

### Clinical

- 所有注册试验：NCT/登记号、内部编号、标题、阶段、状态、地点、入组、起止日期
- 设计：SAD/MAD、随机/盲法/对照、队列、给药频率、制剂、食物影响等
- 终点：安全、PK、PD、疗效、生物标志物
- 结果：只记录已公开结果；若仅注册则写“未发布结果”
- 公司时间线：首例给药、预计完成、预计下一阶段

### Preclinical

- 体外活性：assay、细胞、刺激条件、读数、IC50/IC90/EC50、比较药
- 选择性和 off-target
- 稳定性：胃肠液、血清、代谢、热稳定
- PK：物种、给药途径、剂量、Cmax、AUC、Tmax、t1/2、F、生物利用度
- 组织分布：靶组织/血浆比、暴露倍数
- 动物 PD/疗效模型：物种、品系、模型、分组、剂量、给药时间、读数、统计学
- 毒理：GLP/non-GLP、物种、时长、NOAEL、靶器官、TK 暴露倍数、安全药理、遗传/生殖毒性

### Negative / Missing Evidence

明确列出：

- 未找到 Phase 1 结果
- 未找到 Phase 2 注册或结果
- 未找到 PubMed 论文
- 未找到完整毒理/PK 表
- 未找到监管批准或特殊资格

## 证据分类规则

- `confirmed`: 注册库、论文、SEC 已发生事项、原始会议摘要中的数据。
- `planned`: 公司预计、pipeline milestone、forward-looking statement。
- `derived`: 从图表读取或根据剂量频率换算，如 1 mg/kg BID = 2 mg/kg/day。
- `not_found`: 已检索但未找到；注明检索源和日期。
- `comparator_only`: 比较药或相关药物数据，不得混为目标药数据。
- `failed_access`: URL 存在但 401/403/404/410/429/5xx、登录、验证码、JS 阻断或文件损坏；不得当作 `not_found`，也不得保存为证据来源。
- `unverified_note`: 只有二手转述、缓存摘要或无法回溯原文的线索；不得支撑关键结论。

## 常用命令

```bash
date
mkdir -p <drug>_research/sources <drug>_research/images
curl -L --fail --show-error -o <out> <url>
curl -L -I <url>
curl -L --fail --show-error -w "%{http_code} %{content_type} %{url_effective}\n" -o <tmp> <url>
file <downloaded_file>
pdfinfo <downloaded_pdf>
PYTHONPATH=.agents/skills/drug-evidence-research/scripts uv run python -m drug_doc_links <drug>_research/sources --out <drug>_research/document_candidates.tsv
yt-dlp --dump-json <video_url> > <drug>_research/sources/<source>_metadata.json
yt-dlp -o "<drug>_research/sources/%(title).120s.%(ext)s" <video_url>
ffmpeg -i <video_or_audio> -vn <drug>_research/sources/<source>_audio.wav
ffmpeg -i <video> -ss <HH:MM:SS> -frames:v 1 <drug>_research/images/<source>_<timestamp>.png
pdftotext -layout <in.pdf> <out.txt>
pdftoppm -png -f <page> -l <page> -r 160 <in.pdf> <prefix>
jq empty <drug>_research/<drug>_data.json
rg -n "KEY_TERM|VALUE|NCT" <drug>_research
rg -n "404 Not Found|403 Forbidden|401 Unauthorized|Access Denied|Page not found|captcha|Cloudflare|Please enable JavaScript|not authorized" <drug>_research/sources
find <drug>_research -maxdepth 2 -type f | sort
```

## 报告模板

```markdown
# <DRUG> 公开数据汇总

检索日期：<YYYY-MM-DD>  
当前日期确认：`<date output>`

## 结论摘要

- <当前阶段和最重要结论>
- <是否有临床结果>
- <临床前数据概览>
- <未公开/未找到的关键证据>

## 药物与机制

| 项目 | 数据 |
| --- | --- |
| 名称 | |
| 别名 | |
| 开发方 | |
| 资产属性 | |
| 类型 | |
| 靶点 | |
| 机制 | |
| 给药途径/剂型 | |
| 潜在适应症 | |
| 开发候选物提名 | |

## 临床数据

### 已登记试验

| 字段 | 数据 |
| --- | --- |
| 登记号 | |
| 内部编号 | |
| 标题 | |
| 阶段 | |
| 状态 | |
| 受试者 | |
| 预计/实际入组 | |
| 地点 | |
| 开始 | |
| 主要完成 | |
| 研究完成 | |
| 结果 | |

### 研究设计

- <Part/cohort/design>

### 终点

| 类型 | 终点 | 时间窗 |
| --- | --- | --- |

### 公开临床结果

若无结果，写：截至 <date> 未检索到公开结果。

### 公司披露时间线

| 日期/来源 | 披露 | 证据类型 |
| --- | --- | --- |

## 临床前数据

### 体外活性

| Assay/细胞 | 药物 | 指标 | 数值 | 来源 |
| --- | --- | --- | --- | --- |

### 稳定性

- <数据>

### PK 与组织分布

- <数据>

### 动物 PD/疗效模型

| 模型 | 物种 | 剂量 | 读数 | 结果 | 来源 |
| --- | --- | --- | --- | --- | --- |

### 毒理与 IND-enabling

- <数据>
- 未公开：<缺口>

## 监管状态

- <FDA/EMA/其他>

## 研发费用/商业信息

仅在公开资料中有项目级披露或用户需要时填写。

## 未找到或尚未公开的数据

- <negative finding>

## 本地保存文件

- `sources/`
- `images/`
- `query_log.tsv`
- `document_candidates.tsv`（如执行文档检索）
- `<drug>_data.json`
- `sources_index.md`

## 关键来源

- <URL>
```

## query_log.tsv 格式

```tsv
date	source	query	result_count_or_status	urls_reviewed	notes
YYYY-MM-DD	PubMed	"<alias>" Phase 1	0		negative search
YYYY-MM-DD	ClinicalTrials.gov	<alias>	200; 1 hit	https://clinicaltrials.gov/study/NCT...	archived JSON
```

## JSON 数据结构

顶层字段：

```json
{
  "as_of": "YYYY-MM-DD",
  "compound": {},
  "clinical_trials": [],
  "clinical_status_notes": [],
  "clinical_results": [],
  "in_vitro": {},
  "stability": [],
  "preclinical_pk_distribution": [],
  "animal_pd_models": [],
  "toxicology": {},
  "regulatory": {},
  "publication_search": {},
  "not_found": [],
  "failed_access": [],
  "query_log_file": "query_log.tsv",
  "sources": []
}
```

### compound

```json
{
  "name": "",
  "aliases": [],
  "developer": "",
  "partners": [],
  "asset_status": "",
  "modality": "",
  "target": [],
  "mechanism": "",
  "route_or_formulation": [],
  "potential_indications": [],
  "development_candidate_nomination_date": ""
}
```

### clinical_trials

```json
{
  "registry": "ClinicalTrials.gov",
  "registry_id": "",
  "org_study_id": "",
  "brief_title": "",
  "official_title": "",
  "phase": "",
  "status": "",
  "has_results": false,
  "start_date": "",
  "primary_completion_date": "",
  "completion_date": "",
  "enrollment": {
    "count": 0,
    "type": "ESTIMATED"
  },
  "population": "",
  "locations": [],
  "design": {},
  "arms": [],
  "interventions": [],
  "primary_outcomes": [],
  "secondary_outcomes": [],
  "source_file": ""
}
```

### not_found

```json
{
  "topic": "Phase 2 trial",
  "searched_sources": [
    "ClinicalTrials.gov",
    "company website",
    "SEC filings"
  ],
  "result": "No public registration or result found as of YYYY-MM-DD"
}
```

### failed_access

```json
{
  "url": "",
  "source_label": "",
  "status_code": 403,
  "content_type": "text/html",
  "reason": "Access denied page; not archived as evidence",
  "attempted_methods": [
    "curl",
    "agent-browser"
  ],
  "accessed_date": "YYYY-MM-DD"
}
```

### sources

```json
{
  "label": "",
  "url": "",
  "local_file": "",
  "source_type": "registry|pdf|html|sec|pubmed|conference|company|regulatory",
  "accessed_date": "YYYY-MM-DD"
}
```

## 完成前检查

- 日期已确认。
- 已按 [parallel_retrieval.md](references/parallel_retrieval.md) 并行获取独立来源，所有并行任务结束后才汇总报告。
- `query_log.tsv` 已保存固定查询、扩展查询、命中数/状态和审阅 URL。
- 若目标可能有 poster/slide/deck/abstract/supplement，已执行 [document_retrieval.md](references/document_retrieval.md)，并保存/审阅 `document_candidates.tsv`。
- 至少覆盖注册库、PubMed、公司官网、SEC/监管、会议资料。
- 每个关键数值都可回到本地 source 或 URL。
- 已明确区分人体数据、临床登记、临床前数据。
- 已明确排除或标注相关药物/比较药数据。
- 401/403/404/410/429/5xx、登录页、验证码页、JS 阻断页、空白页和损坏文件未归档为证据，只记录为 `failed_access`；JSON 可解析。
- 用 `rg` 验证重要值在 source 文本或 JSON 中出现。
- 用 `rg` 检查 `sources/` 中没有明显错误页关键词；如有，删除该 source 并改记 `failed_access`。
- 文件清单完整。
- 说明无法下载或无法验证的内容。
