# Parallel Retrieval

默认并行获取资料；只有依赖前一步结果的反查才进入下一轮。并行必须保持可复现：固定任务清单、固定输出文件名、固定排序写入日志。

## 执行波次

### Wave 0: 初始化

- `date`
- 创建输出目录
- 生成 alias/developer/target/query 清单
- 初始化 `query_log.tsv`、`sources_index.md`

### Wave 1: 独立来源并行

同时启动互不依赖的来源：

- 注册库 API：ClinicalTrials.gov、EU/CTIS、WHO ICTRP、地区注册库
- 文献：PubMed、Crossref、Europe PMC、Scholar 线索
- 公司：pipeline、news、press releases、events/presentations、scientific posters、clinical trials
- 监管/财务：SEC EDGAR、FDA、EMA
- 网络搜索：核心 alias 查询、filetype 查询、site 查询

每个任务写独立文件；不要多个任务写同一个输出文件。

### Wave 2: 发现结果反查

基于 Wave 1 发现的新 alias、NCT/登记号、内部 study ID、会议名、作者、标题、PDF 文件名、CDN 目录，再并行反查。

### Wave 3: 文档下载与抽取

并行下载通过候选筛选的 PDF/PPT/DOC/XLS；下载后并行执行 `file`、`pdfinfo`、`pdftotext`、Office 转换和错误页扫描。

### Wave 4: 汇总

所有并行任务完成后再汇总事实。按来源类型、日期、URL 排序写入 `query_log.tsv`、`document_candidates.tsv`、`sources_index.md`，避免并行完成顺序影响最终报告。

## 并发限制

- 默认总并发 6-10；同一域名并发 2-3，避免触发 403/429。
- 对 API/注册库优先使用批量接口；不要拆成大量单条请求。
- 对同一主机出现 429/403 时，降低并发、加 `sleep`、改用浏览器兜底；不要把阻断页保存为 source。
- 大文件下载和文本抽取分开并行；先下载全部候选，再批量抽取文本。

## 推荐命令模式

并行下载 URL 清单：

```bash
xargs -P 6 -n 2 sh -c 'curl -L --fail --show-error -o "$1" "$2"' sh < downloads.tsv
```

并行校验 PDF：

```bash
find <output>/sources -name "*.pdf" -print0 | xargs -0 -P 6 -n 1 pdfinfo
find <output>/sources -name "*.pdf" -print0 | xargs -0 -P 6 -I{} sh -c 'pdftotext -layout "$1" "${1%.pdf}.txt"' sh {}
```

并行抽取 HTML 文档链接前，先并行保存 HTML；随后运行一次：

```bash
PYTHONPATH=.agents/skills/drug-evidence-research/scripts uv run python -m drug_doc_links <output>/sources --out <output>/document_candidates.tsv
```

## 日志规则

- 每个并行任务写 `<task_id>.tmp`，成功校验后再移动到正式文件名。
- `query_log.tsv` 可先写多个 shard：`query_log.registry.tsv`、`query_log.pubmed.tsv`；汇总时排序合并。
- 记录 `parallel_group`、`source`、`query`、`status`、`output_file`、`url`、`notes`。
- 并行失败不代表未找到；失败访问记为 `failed_access` 或 `FAILED_DOC`，并保留尝试方法。

## 完成检查

- Wave 1 的独立来源没有被串行等待。
- Wave 2 反查覆盖了所有新发现的 alias/ID/文件名/标题。
- 所有并行任务已结束后才写最终报告。
- 输出日志按固定键排序，不受任务完成顺序影响。
