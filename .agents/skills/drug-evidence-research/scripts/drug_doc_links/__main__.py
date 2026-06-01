from __future__ import annotations

import argparse
import csv
import html
import re
import sys
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable
from urllib.parse import unquote, urljoin, urlparse


DEFAULT_EXTENSIONS = frozenset({"pdf", "ppt", "pptx", "doc", "docx", "xls", "xlsx"})
ABSOLUTE_URL_RE = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)
TRAILING_PUNCTUATION = ".,;:!?)\\]}\"'"
SKIP_PREFIXES = ("#", "mailto:", "tel:", "javascript:", "data:")


@dataclass(frozen=True)
class Candidate:
  local_file: str
  base_url: str
  kind: str
  url: str
  anchor_text: str
  source: str


@dataclass
class LinkState:
  urls: list[tuple[str, str]]
  text_parts: list[str]


def compact_text(value: str, limit: int = 180) -> str:
  text = " ".join(value.split())
  if len(text) <= limit:
    return text
  return text[: limit - 1] + "..."


def clean_url(value: str) -> str:
  text = html.unescape(value).replace("\\/", "/").strip()
  text = text.strip(" \t\r\n<>")
  while text and text[-1] in TRAILING_PUNCTUATION:
    text = text[:-1]
  return text


def extension_for_url(url: str, extensions: frozenset[str]) -> str | None:
  path = unquote(urlparse(url).path).lower()
  suffix = Path(path).suffix.lower().lstrip(".")
  if suffix in extensions:
    return suffix
  return None


def is_skipped_value(value: str) -> bool:
  lowered = value.strip().lower()
  return lowered.startswith(SKIP_PREFIXES)


def url_from_direct_value(value: str, base_url: str, extensions: frozenset[str]) -> str | None:
  cleaned = clean_url(value)
  if not cleaned or is_skipped_value(cleaned):
    return None
  candidate = cleaned
  if not urlparse(candidate).scheme and base_url:
    candidate = urljoin(base_url, candidate)
  if extension_for_url(candidate, extensions):
    return candidate
  return None


def urls_from_text(value: str, extensions: frozenset[str]) -> list[str]:
  normalized = html.unescape(value).replace("\\/", "/")
  urls: list[str] = []
  for match in ABSOLUTE_URL_RE.finditer(normalized):
    candidate = clean_url(match.group(0))
    if extension_for_url(candidate, extensions):
      urls.append(candidate)
  return urls


def unique_pairs(pairs: Iterable[tuple[str, str]]) -> list[tuple[str, str]]:
  seen: set[tuple[str, str]] = set()
  result: list[tuple[str, str]] = []
  for pair in pairs:
    if pair in seen:
      continue
    seen.add(pair)
    result.append(pair)
  return result


class DocumentLinkParser(HTMLParser):
  def __init__(self, local_file: str, base_url: str, extensions: frozenset[str]) -> None:
    super().__init__(convert_charrefs=True)
    self.local_file = local_file
    self.base_url = base_url
    self.extensions = extensions
    self.candidates: list[Candidate] = []
    self.link_stack: list[LinkState] = []

  def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
    collected: list[tuple[str, str]] = []
    for name, value in attrs:
      if value is None:
        continue
      source = f"{tag}@{name}"
      direct = url_from_direct_value(value, self.base_url, self.extensions)
      if direct:
        collected.append((direct, source))
      for embedded in urls_from_text(value, self.extensions):
        collected.append((embedded, source))

    if tag.lower() == "a":
      self.link_stack.append(LinkState(unique_pairs(collected), []))
      return

    for url, source in unique_pairs(collected):
      self.add_candidate(url, "", source)

  def handle_data(self, data: str) -> None:
    if self.link_stack:
      self.link_stack[-1].text_parts.append(data)

  def handle_endtag(self, tag: str) -> None:
    if tag.lower() != "a" or not self.link_stack:
      return
    state = self.link_stack.pop()
    text = compact_text(" ".join(state.text_parts))
    for url, source in state.urls:
      self.add_candidate(url, text, source)

  def add_candidate(self, url: str, anchor_text: str, source: str) -> None:
    kind = extension_for_url(url, self.extensions)
    if not kind:
      return
    self.candidates.append(
      Candidate(
        local_file=self.local_file,
        base_url=self.base_url,
        kind=kind,
        url=url,
        anchor_text=anchor_text,
        source=source,
      )
    )


def expand_inputs(inputs: list[str]) -> list[Path]:
  files: list[Path] = []
  for item in inputs:
    path = Path(item)
    if path.is_dir():
      files.extend(sorted(path.rglob("*.html")))
      files.extend(sorted(path.rglob("*.htm")))
      continue
    files.append(path)
  return sorted(dict.fromkeys(files))


def load_base_map(path: str | None) -> dict[str, str]:
  if not path:
    return {}
  mapping: dict[str, str] = {}
  with Path(path).open("r", encoding="utf-8", newline="") as handle:
    reader = csv.reader(handle, delimiter="\t")
    for row in reader:
      if len(row) < 2 or not row[0] or row[0].startswith("#"):
        continue
      if row[0].lower() in {"local_file", "file", "path"}:
        continue
      local_file = row[0].strip()
      source_url = row[1].strip()
      mapping[local_file] = source_url
      mapping[Path(local_file).name] = source_url
  return mapping


def base_url_for(path: Path, base_map: dict[str, str], fallback: str) -> str:
  keys = [str(path), path.as_posix(), path.name]
  for key in keys:
    if key in base_map:
      return base_map[key]
  return fallback


def parse_file(path: Path, base_url: str, extensions: frozenset[str]) -> list[Candidate]:
  parser = DocumentLinkParser(str(path), base_url, extensions)
  content = path.read_text(encoding="utf-8", errors="replace")
  parser.feed(content)
  parser.close()
  for embedded in urls_from_text(content, extensions):
    parser.add_candidate(embedded, "", "raw")
  return parser.candidates


def merge_candidates(candidates: Iterable[Candidate]) -> list[Candidate]:
  merged: dict[tuple[str, str], Candidate] = {}
  for candidate in candidates:
    key = (candidate.local_file, candidate.url)
    existing = merged.get(key)
    if existing is None:
      merged[key] = candidate
      continue
    if not existing.anchor_text and candidate.anchor_text:
      merged[key] = candidate
  return sorted(merged.values(), key=lambda item: (item.local_file, item.kind, item.url))


def write_tsv(candidates: list[Candidate], output_path: str | None) -> None:
  fieldnames = ["local_file", "base_url", "kind", "url", "anchor_text", "source"]
  if output_path:
    handle = Path(output_path).open("w", encoding="utf-8", newline="")
    close_handle = True
  else:
    handle = sys.stdout
    close_handle = False
  try:
    writer = csv.DictWriter(handle, fieldnames=fieldnames, delimiter="\t", lineterminator="\n")
    writer.writeheader()
    for candidate in candidates:
      writer.writerow(
        {
          "local_file": candidate.local_file,
          "base_url": candidate.base_url,
          "kind": candidate.kind,
          "url": candidate.url,
          "anchor_text": candidate.anchor_text,
          "source": candidate.source,
        }
      )
  finally:
    if close_handle:
      handle.close()


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(
    description="Extract PDF/PPT/DOC/XLS links from saved HTML files."
  )
  parser.add_argument("inputs", nargs="+", help="HTML files or directories containing HTML files.")
  parser.add_argument("--base-url", default="", help="Fallback source URL for resolving relative links.")
  parser.add_argument(
    "--base-map",
    default=None,
    help="TSV with local_file and source_url columns for per-file relative URL resolution.",
  )
  parser.add_argument("--out", default=None, help="Write TSV output to this path.")
  parser.add_argument(
    "--extensions",
    default=",".join(sorted(DEFAULT_EXTENSIONS)),
    help="Comma-separated document extensions to extract.",
  )
  return parser.parse_args()


def main() -> int:
  args = parse_args()
  extensions = frozenset(
    item.strip().lower().lstrip(".") for item in args.extensions.split(",") if item.strip()
  )
  files = expand_inputs(args.inputs)
  base_map = load_base_map(args.base_map)
  candidates: list[Candidate] = []
  for path in files:
    if not path.exists():
      print(f"missing input: {path}", file=sys.stderr)
      continue
    base_url = base_url_for(path, base_map, args.base_url)
    candidates.extend(parse_file(path, base_url, extensions))
  write_tsv(merge_candidates(candidates), args.out)
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
