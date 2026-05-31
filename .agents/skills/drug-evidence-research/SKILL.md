---
name: drug-evidence-research
description: Systematic public evidence research workflow for drug candidates, code names, biologics, peptides, small molecules, and company assets. Use when Codex needs to search, verify, archive, and summarize all available public clinical, preclinical, animal, regulatory, publication, conference, company, and trial-registry data for a compound, then save a local report and structured dataset.
---

# Drug Evidence Research

## Overview

Use this skill to run a reproducible public evidence search for a drug or code name and save the result locally. The goal is to separate confirmed data from plans, claims, analog data, and missing/unpublished evidence.

## Workflow

1. Confirm date/time before searching if the request is time-sensitive or asks for current/latest status.
2. Create an output directory named after the compound, e.g. `<drug>_research/`, with `sources/` and optional `images/`.
3. Search broadly using exact and variant names:
   - exact code: `"PN-881"`
   - hyphenless form: `PN881`
   - company + code
   - target/mechanism + code
   - trial ID, internal study ID, indication terms when discovered
4. Prioritize primary sources:
   - ClinicalTrials.gov and other trial registries
   - PubMed / Crossref / publisher pages
   - Company pages, investor decks, scientific posters, press releases
   - SEC/EDGAR filings for public companies
   - Conference abstract books and poster PDFs
   - FDA/EMA/regulatory databases when relevant
5. Archive raw sources locally where access allows:
   - PDFs, HTML pages, registry JSON, search API JSON
   - extracted `.txt` from PDFs/HTML when useful
   - key chart screenshots/images when PDF text extraction loses labels
6. Extract facts into structured categories:
   - compound identity and mechanism
   - clinical trials and clinical results
   - in vitro pharmacology
   - animal PD/efficacy models
   - PK, tissue distribution, formulation
   - toxicology and IND-enabling work
   - regulatory status
   - publications and conference data
   - company timelines, financing/R&D expense if relevant
   - explicitly missing or not public data
7. Verify boundaries:
   - Do not transfer data from related assets unless clearly labeled as analog/comparator data.
   - Distinguish trial registration from trial results.
   - Distinguish company forward-looking plans from completed events.
   - Record negative searches, e.g. no PubMed hits or no Phase 2 registry entry.
8. Save final artifacts:
   - `<DRUG>_research_report.md`
   - `<drug>_data.json`
   - `sources_index.md`
   - raw files under `sources/`

## Details

Read `references/sop.md` before executing the full workflow. Use `references/report-template.md` for the report structure and `references/data-schema.md` for JSON fields.

## Validation

Before finishing:

- Validate JSON with `jq empty`.
- List saved files.
- Use `rg` to verify important values in the report appear in source text or source JSON.
- State what could not be downloaded or verified.
