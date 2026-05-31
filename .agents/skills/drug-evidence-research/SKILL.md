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

## 核心原则

1. **报告优先**：先创建报告、数据文件和 source index，再边检索边更新，不能最后凭记忆补。
2. **先消歧再搜索**：先确认药物身份、别名、公司、靶点、适应症和同名冲突；无法确认时把候选身份并列表述。
3. **英文优先**：数据库和 web 检索优先使用英文名、代号、公司名、靶点；中文、日文等本地语言只作补充。
4. **多源三角验证**：关键结论至少尝试用注册库、公司/SEC/监管、论文/会议中的两个来源交叉确认。
5. **证据分级**：每条关键事实必须标注证据类型：`confirmed`、`planned`、`derived`、`not_found`、`comparator_only`。
6. **负结果也是结果**：无命中、失败、被阻断、仅找到计划披露，都要写入 `sources_index.md` 和报告。
7. **不要静默跳过失败来源**：API、curl、PDF、网页失败后按 fallback 链重试；仍失败则记录失败原因。
8. **原始来源优先**：第三方聚合站只作线索，尽量回到注册库、论文、公司原文、监管库、SEC、会议材料。

## 快速工作流

1. 若请求涉及当前状态、最新进展或时效性结论，先运行 `date` 记录当前日期时间。
2. 创建 `<drug>_research/`、`sources/`、`images/`，并立即初始化：
   - `<DRUG>_research_report.md`
   - `<drug>_data.json`
   - `sources_index.md`
   - `search_log.tsv`
3. 执行 Phase 0 消歧：确认输入是代号、INN、商品名、公司资产、SMILES、登记号或靶点项目。
4. 读取 `references/search-playbook.md`，按搜索矩阵生成查询并记录到 `search_log.tsv`。
5. 按来源优先级并行检索：注册库、PubMed/论文、公司官网、SEC/EDGAR、监管库、会议资料、专利/化学库。
6. 归档原文、API JSON、PDF 文本、网页文本和必要截图；每个文件写入 `sources_index.md`。
7. 抽取事实并写入报告和 JSON；任何缺口写入 `not_found`。
8. 完成前运行检查命令，确认 JSON 可解析、关键值可回溯、报告无 `[Researching...]`。

## Phase 0：身份消歧

先建立 `identity_candidates`，不要把相同缩写、比较药、公司平台名误认为目标药。

必须检查：

- 精确代号、去连字符代号、大小写变体。
- INN、商品名、旧名、合作方编号、内部 study id。
- 开发方、合作方、资产归属、靶点、适应症。
- 同名冲突：其他药物、基因、公司项目、会议缩写、疾病缩写、普通词。
- 若发现 NCT、EudraCT、IND、poster id、patent id，反向检索这些编号。

消歧输出写入报告：

```markdown
## 身份消歧

| 候选身份 | 支持证据 | 是否纳入 |
| --- | --- | --- |
| <name/company/target> | <source> | yes/no/uncertain |

检索过滤规则：<例如必须同时包含公司名或靶点，排除无关缩写>
```

## 搜索矩阵

详细查询模板见 `references/search-playbook.md`。至少覆盖下列维度：

| 维度 | 高精度查询 | 扩展查询 |
| --- | --- | --- |
| 身份 | `"CODE" company target` | `CODE OR CODEwithoutdash` |
| 临床登记 | `CODE NCT Phase 1` | `company target healthy volunteers trial` |
| 临床结果 | `CODE results OR topline OR poster` | `target indication phase 1 data` |
| 临床前 | `CODE preclinical PK toxicology` | `company target animal model` |
| 会议 | `CODE poster abstract presentation` | `company target conference` |
| 公司披露 | `site:company.com CODE` | `CODE investor presentation SEC` |
| 监管/SEC | `CODE 10-K 8-K S-1` | `company pipeline candidate` |
| 专利/结构 | `CODE patent composition` | `company target peptide sequence` |

搜索日志字段：

```tsv
date	source	query	result_count	top_hits	action	status
```

## 来源优先级与 fallback

### 临床注册

优先：

- ClinicalTrials.gov 网页和 API：
  - `https://clinicaltrials.gov/api/v2/studies/<NCT_ID>`
  - `https://clinicaltrials.gov/api/v2/studies?query.term=<TERM>&format=json`
- EU Clinical Trials Register / CTIS
- WHO ICTRP
- 中国药物临床试验登记与信息公示平台
- ANZCTR、日本 jRCT 等地区注册库

Fallback：

1. 精确药名无命中时，用公司 + 靶点 + 适应症。
2. 注册库无命中时，搜公司 press release、SEC、会议摘要里的 trial id。
3. 仍无命中时，记录 `not_found`，不要推断“没有临床”。

### 论文与摘要

优先：

- PubMed API：
  - `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=pubmed&term=<QUERY>&retmode=json`
- Europe PMC、Crossref、publisher 页面
- 会议官网 abstract book、poster PDF、oral presentation PDF

Fallback：

1. 精确代号无命中时，用公司 + 靶点 + modality。
2. PubMed 无命中时查 Europe PMC、Crossref、会议材料和公司 scientific publications。
3. 记录每个数据库的 negative search。

### 公司与监管

优先：

- 公司官网：pipeline、press releases、events/presentations、scientific posters
- SEC EDGAR：10-K、10-Q、8-K、S-1、exhibit investor deck
- FDA/EMA：批准、标签、审评文件、孤儿药/快速通道等资格
- 专利只在需要化学结构、序列、先导物或 IP 边界时检索；专利信息不等于临床证据。

Fallback：

1. 官网搜索失败时使用 `site:<domain> CODE` 和 SEC exhibit。
2. PDF 下载失败时尝试浏览器保存、文本提取或截图。
3. 公司计划、forward-looking statement 必须标成 `planned`。

## 归档规范

保存原文或机器可读版本：

- PDF: `curl -L --fail -o sources/<date_or_source>_<title>.pdf <url>`
- HTML: `curl -L --fail -o sources/<date_or_source>_<title>.html <url>`
- API JSON: `curl -L --fail -o sources/<name>.json <url>`
- PDF 文本：`pdftotext -layout input.pdf output.txt`
- HTML 文本：可用标准库 `html.parser` 提取到 `.txt`
- 图表截图：当 PDF 文本缺失剂量、坐标轴、统计标记时，用 `pdftoppm` 转关键页到 `images/`

若 `curl`、`wget` 或 API 请求因浏览器限定、访问阻断、JavaScript 渲染等原因无法下载或读取来源：

- 使用 `agent-browser` skill 打开页面、抽取可见文本、保存 PDF 或截图。
- 将浏览器产物归档到 `sources/` 或 `images/`。
- 在 `sources_index.md` 记录 URL、访问日期、使用命令和失败/成功状态。

若证据来源是公司 webcast、会议录像、访谈、YouTube/Vimeo/X/Twitter/其他视频平台：

- 使用 `yt-dlp` skill 保存 metadata JSON，再按需要下载视频或抽取音频。
- 使用 `ffmpeg` skill 生成可检索音频、裁剪相关片段、截取关键画面。
- 不要把口头计划或访谈表述自动当作已完成数据；按 `planned`、`confirmed` 或 `not_found` 分类。
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
- `not_found`: 已检索但未找到；注明检索源、查询式和日期。
- `comparator_only`: 比较药或相关药物数据，不得混为目标药数据。

## 常用命令

```bash
date
mkdir -p <drug>_research/sources <drug>_research/images
touch <drug>_research/search_log.tsv
curl -L --fail -o <out> <url>
yt-dlp --dump-json <video_url> > <drug>_research/sources/<source>_metadata.json
yt-dlp -o "<drug>_research/sources/%(title).120s.%(ext)s" <video_url>
ffmpeg -i <video_or_audio> -vn <drug>_research/sources/<source>_audio.wav
ffmpeg -i <video> -ss <HH:MM:SS> -frames:v 1 <drug>_research/images/<source>_<timestamp>.png
pdftotext -layout <in.pdf> <out.txt>
pdftoppm -png -f <page> -l <page> -r 160 <in.pdf> <prefix>
jq empty <drug>_research/<drug>_data.json
rg -n "KEY_TERM|VALUE|NCT" <drug>_research
find <drug>_research -maxdepth 2 -type f | sort
```

## 报告模板

```markdown
# <DRUG> 公开数据汇总

检索日期：<YYYY-MM-DD>
当前日期确认：`<date output>`
原始请求：<user query>

## 结论摘要

- <当前阶段和最重要结论>
- <是否有临床结果>
- <临床前数据概览>
- <未公开/未找到的关键证据>

## 身份消歧

| 候选身份 | 支持证据 | 是否纳入 |
| --- | --- | --- |

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

| Assay/细胞 | 药物 | 指标 | 数值 | 证据类型 | 来源 |
| --- | --- | --- | --- | --- | --- |

### 稳定性

- <数据>

### PK 与组织分布

- <数据>

### 动物 PD/疗效模型

| 模型 | 物种 | 剂量 | 读数 | 结果 | 证据类型 | 来源 |
| --- | --- | --- | --- | --- | --- | --- |

### 毒理与 IND-enabling

- <数据>
- 未公开：<缺口>

## 监管状态

- <FDA/EMA/其他>

## 研发费用/商业信息

仅在公开资料中有项目级披露或用户需要时填写。

## 未找到或尚未公开的数据

| 主题 | 已检索来源/查询 | 结论 |
| --- | --- | --- |

## 本地保存文件

- `sources/`
- `images/`
- `<drug>_data.json`
- `sources_index.md`
- `search_log.tsv`

## 关键来源

- <URL>
```

## JSON 数据结构

顶层字段：

```json
{
  "as_of": "YYYY-MM-DD",
  "query": "",
  "identity_candidates": [],
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
  "search_log": [],
  "not_found": [],
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
  "source_file": "",
  "evidence_type": "confirmed"
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
  "queries": [],
  "result": "No public registration or result found as of YYYY-MM-DD"
}
```

### sources

```json
{
  "label": "",
  "url": "",
  "local_file": "",
  "source_type": "registry|pdf|html|sec|pubmed|conference|company|regulatory|patent|video",
  "accessed_date": "YYYY-MM-DD",
  "status": "saved|failed|blocked|metadata_only"
}
```

## 完成前检查

- 日期已确认。
- 已初始化报告、JSON、source index、search log。
- 已完成身份消歧并记录冲突/排除规则。
- 至少覆盖注册库、PubMed/论文、公司官网、SEC/监管、会议资料。
- 每个关键数值都可回到本地 source 或 URL。
- 已明确区分人体数据、临床登记、临床前数据、比较药数据。
- 已明确记录 negative search，包括查询式和来源。
- JSON 可解析：`jq empty <drug>_research/<drug>_data.json`。
- 用 `rg` 验证重要值在 source 文本或 JSON 中出现。
- 文件清单完整。
- 说明无法下载、无法访问或无法验证的内容。
- 报告无 `[Researching...]` 占位符。
