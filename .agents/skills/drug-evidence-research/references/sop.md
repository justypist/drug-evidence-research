# 药物公开证据检索 SOP

## 目标

针对任意药物代号/通用名/项目名，系统检索并归档公开资料，输出可追溯报告。优先回答：

- 当前临床阶段是什么？
- 是否有 Phase 1/2/3 登记和结果？
- 临床前、动物、PK、毒理数据有哪些？
- 哪些数据只是公司计划，哪些已经完成？
- 哪些重要数据尚未公开或未检索到？

## 1. 准备

1. 确认当前日期时间：
   - Linux/macOS: `date`
2. 建目录：
   - `<drug>_research/sources`
   - `<drug>_research/images`，仅在需要图表核对时创建
3. 记录检索日期、药物名称、已知公司、靶点、适应症。

## 2. 名称变体

至少检索：

- 精确代号：`"PN-881"`
- 去连字符：`PN881`
- 公司 + 代号：`Protagonist PN-881`
- 代号 + 靶点：`PN-881 IL-17`
- 代号 + 阶段：`PN-881 Phase 1`、`PN-881 Phase 2`
- 代号 + 数据类型：`preclinical`、`animal`、`mouse`、`rat`、`PK`、`toxicology`、`IC50`
- 代号 + 登记号/内部编号，发现后反向检索。

如药物有 INN、商品名、旧名、合作方编号，加入同一轮检索，并在报告中说明同义关系。

## 3. 来源优先级

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
- SEC EDGAR：10-K、10-Q、8-K、exhibit investor deck
- FDA/EMA：批准、标签、审评文件、孤儿药/快速通道等资格
- 专利只在需要化学结构、序列、先导物或 IP 边界时检索；报告中明确专利信息不等于临床证据。

## 4. 归档规范

保存原文或机器可读版本：

- PDF: `curl -L --fail -o sources/<date_or_source>_<title>.pdf <url>`
- HTML: `curl -L --fail -o sources/<date_or_source>_<title>.html <url>`
- API JSON: `curl -L --fail -o sources/<name>.json <url>`
- PDF 文本：`pdftotext -layout input.pdf output.txt`
- HTML 文本：可用 Python `html.parser` 提取到 `.txt`
- 图表截图：当 PDF 文本缺失剂量、坐标轴、统计标记时，用 `pdftoppm` 转关键页到 `images/`

若网页禁止下载但浏览器可访问，在 `sources_index.md` 记录 URL 和失败原因。

## 5. 信息抽取清单

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

## 6. 证据分类规则

- `confirmed`: 注册库、论文、SEC 已发生事项、原始会议摘要中的数据。
- `planned`: 公司预计、pipeline milestone、forward-looking statement。
- `derived`: 从图表读取或根据剂量频率换算，如 1 mg/kg BID = 2 mg/kg/day。
- `not_found`: 已检索但未找到；注明检索源和日期。
- `comparator_only`: 比较药或相关药物数据，不得混为目标药数据。

## 7. 常用命令

```bash
date
mkdir -p <drug>_research/sources <drug>_research/images
curl -L --fail -o <out> <url>
pdftotext -layout <in.pdf> <out.txt>
pdftoppm -png -f <page> -l <page> -r 160 <in.pdf> <prefix>
jq empty <drug>_research/<drug>_data.json
rg -n "KEY_TERM|VALUE|NCT" <drug>_research
find <drug>_research -maxdepth 2 -type f | sort
```

遵循项目偏好：Python 脚本用 `uv run python -m ...`；简单一次性 HTML 解析如无模块结构，也可用 `uv run python - <<'PY'`。

## 8. 质量检查

完成前检查：

- 日期已确认。
- 至少覆盖注册库、PubMed、公司官网、SEC/监管、会议资料。
- 每个关键数值都可回到本地 source 或 URL。
- 已明确区分人体数据、临床登记、临床前数据。
- 已明确排除或标注相关药物/比较药数据。
- JSON 可解析。
- 文件清单完整。
