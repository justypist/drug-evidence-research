# Document Retrieval

当研究目标可能有 PDF、PPT、DOC、XLS、poster、slide deck、abstract book、supplement 或公司演示文档时，优先执行本流程。目标是稳定发现并归档原始文档，而不是只保存承载页面。

## 固定流程

1. 保存候选 HTML 页面：公司 `scientific posters/presentations`、`events`、`news`、`pipeline`、会议页面、投资者页面、SEC exhibit 页面。
2. 从已保存 HTML 中抽取文档链接，生成 `document_candidates.tsv`。
3. 对每个文档 URL 做 HEAD/GET 校验；只归档 2xx 且 content type/文件头匹配的文档。
4. 下载到临时文件，校验大小、MIME、页数/文本可提取性，再移动到 `sources/`。
5. 每个成功文档生成文本副本或元数据：
   - PDF: `pdftotext -layout`，必要时 `pdfinfo`
   - PPT/PPTX/DOC/DOCX/XLS/XLSX: 优先 `soffice --headless --convert-to pdf` 或 `libreoffice --headless` 转 PDF/TXT；无工具时保存原文并记录无法抽取
6. 用文档文件名、标题、作者、会议名、公司名、URL 末段反向检索一轮。
7. 在 `sources_index.md` 记录成功文档和失败访问；在 `query_log.tsv` 记录文档检索与反查。

## 固定查询

对每个 alias/developer/target 使用：

```text
"<alias>" filetype:pdf
"<alias>" filetype:ppt OR filetype:pptx
"<alias>" filetype:doc OR filetype:docx
"<alias>" poster OR presentation OR slides OR deck OR abstract
"<alias>" "<conference>" pdf
"<alias>" "<author>" pdf
"<developer>" "<alias>" "files/uploaded"
"<developer-domain>" "<alias>" ".pdf"
site:<company-domain> <alias> pdf
site:<company-domain> <alias> poster
site:<known-cdn-domain> <alias>
```

发现真实文档 URL 后再反查：

```text
"<filename_without_extension>"
"<url_basename>"
"<document title>"
"<author>" "<alias>"
```

## HTML 抽链

保存 HTML 后运行脚本：

```bash
PYTHONPATH=.agents/skills/drug-evidence-research/scripts uv run python -m drug_doc_links <output>/sources --out <output>/document_candidates.tsv
```

若需要解析相对 URL，先创建 base map：

```tsv
local_file	source_url
<output>/sources/company_posters.html	https://example.com/scientific-posters
```

再运行：

```bash
PYTHONPATH=.agents/skills/drug-evidence-research/scripts uv run python -m drug_doc_links <output>/sources --base-map <output>/html_base_urls.tsv --out <output>/document_candidates.tsv
```

必须审阅 `document_candidates.tsv` 中所有包含目标 alias、developer、target、会议名、作者名、`poster`、`presentation`、`abstract`、`deck` 的候选。不要只依赖页面可见文字；很多公司站点把 PDF 链接藏在按钮属性、JSON、`data-*` 或 CDN URL 中。

## URL 变体与 CDN

对公司站点常见情况做变体尝试：

- `http` 与 `https`
- `www` 与非 `www`
- 尾部 `/` 与无 `/`
- URL 编码/解码后的文件名
- CDN 主机：`irp.cdn-website.com`、`static.cdn-website.com`、`s3.amazonaws.com`、`amazonaws.com`、`cloudfront.net`、`wp-content/uploads`
- 文件名前缀数字、空格替换：`9_2025-EADV...pdf`、`2025_EADV...pdf`、`2025-EADV...pdf`

只要一个 HTML 页面出现 CDN 上传目录，必须搜索同一页面和同一目录下的全部文档 URL，并按文件名关键词筛选。

## 校验与归档

下载规则：

```bash
curl -L --fail --show-error -w "%{http_code} %{content_type} %{url_effective}\n" -o <tmp> <url>
file <tmp>
pdfinfo <tmp>
pdftotext -layout <tmp> <txt>
```

归档条件：

- HTTP 最终状态为 2xx。
- 文件扩展名、content type、`file` 结果一致或合理。
- PDF 可被 `pdfinfo` 解析，页数大于 0，通常大于 5 KB。
- PPT/DOC/XLS 不是 HTML 错误页；必要时用 `file` 验证为 Microsoft/OOXML/ZIP 文档。
- 文本或元数据中命中 alias、developer、target、会议名、作者或项目主题之一；若不命中，只能作为相关线索，不支撑结论。

失败访问只记录，不保存：

```markdown
- FAILED_DOC | <status/content-type> | <url> | <reason> | tried: <curl/browser/search> | <YYYY-MM-DD>
```

## sources_index.md 成功文档格式

```markdown
### <label>

| 字段 | 值 |
| --- | --- |
| URL | <direct-document-url> |
| 发现来源 | <html page/search query/sec filing> |
| 本地文档 | `sources/<file>` |
| 文本/元数据 | `sources/<file>.txt` |
| 类型 | PDF/PPTX/DOCX/... |
| HTTP/content-type | <status/content-type> |
| 校验 | <file/pdfinfo/page count/text hit> |
| 访问日期 | <YYYY-MM-DD> |
```

## 完成前文档检查

- `document_candidates.tsv` 已生成并审阅。
- 所有候选公司/会议/投资者 HTML 均已抽链。
- 所有目标相关 PDF/PPT/DOC/XLS 候选都已下载或记录为 `FAILED_DOC`。
- 每个成功 PDF 有 `.txt` 或明确说明无法提取。
- 用文件名、标题、作者、会议名做过反向检索。
- 报告中的图表/数值优先引用直接文档，不只引用承载页面。
