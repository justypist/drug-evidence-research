# Drug Evidence Search Playbook

本文件用于 `drug-evidence-research` skill 的具体检索设计。目标是提高召回率，同时控制同名冲突和比较药污染。

## 查询生成顺序

1. 建立实体包：
   - `CODE`: 原始代号，如 `PN-881`
   - `CODE_NODASH`: 去连字符，如 `PN881`
   - `COMPANY`: 开发方/合作方
   - `TARGET`: 靶点或通路
   - `INDICATION`: 适应症
   - `MODALITY`: small molecule、antibody、peptide、oral antagonist 等
   - `REGISTRY_ID`: NCT/EudraCT/ChiCTR/jRCT 等
2. 先跑高精度查询，确认身份和原始来源。
3. 再跑扩展查询，挖掘会议、临床前和投资者材料。
4. 每个来源至少记录一次 negative search；无命中不是空白。

## Web 查询模板

### 身份与别名

```text
"CODE" "COMPANY"
"CODE" "TARGET"
"CODE" "INDICATION"
"CODE" "pipeline"
"CODE_NODASH" "COMPANY"
"CODE" OR "CODE_NODASH" "drug"
"CODE" "development candidate"
```

若代号是短词或常见缩写，加限制词：

```text
"CODE" "COMPANY" "TARGET" -stock -job -conference
"CODE" "COMPANY" "drug" -"unrelated term"
```

### 临床登记

```text
"CODE" "ClinicalTrials.gov"
"CODE" NCT
"CODE" "Phase 1"
"CODE" "Phase 2"
"CODE" "healthy volunteers"
"COMPANY" "TARGET" "Phase 1"
"COMPANY" "INDICATION" "trial"
"REGISTRY_ID"
```

ClinicalTrials.gov API：

```text
https://clinicaltrials.gov/api/v2/studies?query.term="CODE"&format=json
https://clinicaltrials.gov/api/v2/studies?query.term="COMPANY TARGET"&format=json
https://clinicaltrials.gov/api/v2/studies?query.term="INDICATION COMPANY"&format=json
```

### 临床结果和时间线

```text
"CODE" results
"CODE" topline
"CODE" "interim data"
"CODE" "clinical data"
"CODE" "SAD" OR "MAD"
"CODE" "pharmacokinetic" OR "PK"
"CODE" "pharmacodynamic" OR "PD"
"CODE" "safety" "tolerability"
"COMPANY" "CODE" "first subject dosed"
"COMPANY" "CODE" "completed enrollment"
"COMPANY" "CODE" "data expected"
```

### 临床前/动物/毒理

```text
"CODE" preclinical
"CODE" "in vitro"
"CODE" IC50 OR EC50 OR IC90
"CODE" mouse OR mice OR rat
"CODE" "animal model"
"CODE" "pharmacokinetic" OR "PK"
"CODE" toxicology OR toxicity OR NOAEL
"CODE" "IND-enabling"
"COMPANY" "TARGET" "preclinical"
"COMPANY" "TARGET" "animal"
"MODALITY" "TARGET" "COMPANY"
```

### 会议与海报

```text
"CODE" poster
"CODE" abstract
"CODE" presentation
"CODE" "scientific poster"
"CODE" "oral presentation"
"COMPANY" "CODE" "conference"
"COMPANY" "TARGET" "poster"
"COMPANY" "TARGET" "abstract book"
site:*.org "CODE" "abstract"
site:*.org "COMPANY" "TARGET" "poster"
```

常见会议补充词按适应症加入，例如 `AAD`、`EADV`、`ACR`、`DDW`、`ASCO`、`ASH`、`EASL`、`AASLD`、`ATS`、`ERS`。

### 公司官网

```text
site:COMPANY_DOMAIN "CODE"
site:COMPANY_DOMAIN "CODE_NODASH"
site:COMPANY_DOMAIN "TARGET" "pipeline"
site:COMPANY_DOMAIN "CODE" filetype:pdf
site:COMPANY_DOMAIN "scientific publications" "CODE"
site:COMPANY_DOMAIN "events" "CODE"
```

优先页面类型：

- pipeline
- press releases/news
- investors/events/presentations
- scientific publications/posters
- SEC filings links

### SEC/EDGAR 与融资材料

```text
"CODE" "10-K"
"CODE" "10-Q"
"CODE" "8-K"
"CODE" "S-1"
"CODE" "EX-99"
"CODE" "investor presentation"
"COMPANY" "CODE" "SEC"
"COMPANY" "TARGET" "Form 10-K"
site:sec.gov "CODE" "COMPANY"
site:sec.gov "COMPANY" "TARGET" "pipeline"
```

SEC 中的里程碑通常标为：

- 已发生事项：`confirmed`
- 预计读出/启动：`planned`
- 风险因素或泛化描述：只作背景，不当作数据

### 监管

```text
"CODE" FDA
"CODE" EMA
"CODE" orphan drug
"CODE" fast track
"CODE" IND
"COMPANY" "CODE" "FDA clearance"
"COMPANY" "CODE" "IND cleared"
```

若目标药是未上市资产，未找到标签或审批很常见，仍要记录。

### 专利/结构/序列

仅在需要化学结构、肽序列、抗体序列、组合物或先导物信息时使用：

```text
"CODE" patent
"COMPANY" "TARGET" patent
"COMPANY" "CODE" "composition of matter"
"COMPANY" "TARGET" "WO"
"COMPANY" "TARGET" "sequence"
"COMPANY" "TARGET" "peptide"
```

专利只说明候选结构/权利要求线索，不等于目标药的已确认临床或临床前数据。

## PubMed 查询模板

高精度：

```text
"CODE"[Title/Abstract]
("CODE"[Title/Abstract]) AND ("COMPANY"[Title/Abstract])
("CODE"[Title/Abstract]) AND ("TARGET"[Title/Abstract] OR "INDICATION"[Title/Abstract])
```

扩展：

```text
("COMPANY"[Title/Abstract]) AND ("TARGET"[Title/Abstract])
("TARGET"[Title/Abstract]) AND ("MODALITY"[Title/Abstract]) AND ("INDICATION"[Title/Abstract])
("TARGET"[Title/Abstract]) AND ("antagonist" OR "agonist" OR "inhibitor") AND ("COMPANY")
```

排除同名冲突：

```text
("CODE"[Title/Abstract]) NOT ("unrelated meaning"[Title/Abstract])
```

记录：

- 查询式
- 命中数
- 纳入 PMID
- 排除原因

## 结果筛选与排序

先按来源权威性，再按相关性和新鲜度排序：

1. 注册库、监管库、SEC 已提交文件、peer-reviewed paper
2. 公司 press release、investor deck、会议官网 abstract/poster
3. Publisher ahead-of-print、preprint、专业媒体
4. 第三方数据库、新闻转载、聚合站

相关性评分可人工判断：

| 因素 | 高分信号 |
| --- | --- |
| 身份匹配 | 同时出现 code + company 或 code + target |
| 数据类型 | 有剂量、受试者、模型、数值、日期 |
| 原始性 | registry/API/PDF/SEC 原文 |
| 新鲜度 | 最新 pipeline 或最近 filings |
| 可归档性 | 可保存 URL/PDF/JSON/截图 |

## 冲突处理

出现冲突时，按以下方式写入报告：

- 注册库与公司披露日期不同：分别列出，并说明一个是注册更新时间，一个是公司披露时间。
- 公司称“initiated Phase 2”但无注册：标 `planned` 或 `company_disclosed`，并写明未找到注册。
- 投资者材料数值和论文数值不同：优先原始论文/会议摘要；投资者材料作补充。
- 图表读数非文本：标 `derived`，说明从图中读取。
- 比较药/同靶点药数据：标 `comparator_only`，不得放入目标药事实表。

## search_log.tsv 示例

```tsv
date	source	query	result_count	top_hits	action	status
2026-06-01	PubMed	"CODE"[Title/Abstract]	0		negative search	recorded
2026-06-01	ClinicalTrials.gov	COMPANY TARGET	1	NCT00000000	saved JSON	saved
2026-06-01	company site	site:company.com "CODE"	3	investor deck, poster	downloaded PDF	saved
```

## 最低完成标准

除非用户要求快速概览，否则一个完整研究包至少应满足：

- 身份消歧表已填。
- `search_log.tsv` 包含注册库、PubMed、公司、SEC/监管、会议五类来源。
- 每个纳入来源都有 URL、本地文件或失败记录。
- 每个关键结论有证据类型。
- 至少 3 条 negative search，覆盖临床结果、Phase 2/3、毒理/PK 或论文缺口中的相关项。
- 报告和 JSON 的日期一致。
