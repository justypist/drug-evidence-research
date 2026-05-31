# JSON 数据结构建议

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
  "sources": []
}
```

## compound

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

## clinical_trials

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

## not_found

Use entries like:

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

## sources

```json
{
  "label": "",
  "url": "",
  "local_file": "",
  "source_type": "registry|pdf|html|sec|pubmed|conference|company|regulatory",
  "accessed_date": "YYYY-MM-DD"
}
```
