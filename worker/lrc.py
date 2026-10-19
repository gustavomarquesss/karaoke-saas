"""Parsing de LRC, texto puro e utilitários de tempo. Sem dependências pesadas (testável)."""
from __future__ import annotations

import re
from typing import Any

TAG_RE = re.compile(r"\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]")
WORD_TAG_RE = re.compile(r"<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>")
META_RE = re.compile(r"^\[(ar|ti|al|by|offset|length|re|ve|au):", re.I)


def _tag_seconds(m: re.Match) -> float:
    minutes, seconds, frac = int(m.group(1)), int(m.group(2)), m.group(3)
    f = int(frac) / (10 ** len(frac)) if frac else 0.0
    return minutes * 60 + seconds + f


def parse_lrc(text: str) -> list[tuple[float, str]]:
    """Devolve [(tempo_em_segundos, texto)] ordenado. Aceita várias tags por linha."""
    entries: list[tuple[float, str]] = []
    for raw in text.splitlines():
        raw = raw.strip()
        if not raw or META_RE.match(raw):
            continue
        tags = list(TAG_RE.finditer(raw))
        if not tags:
            continue
        content = WORD_TAG_RE.sub("", raw[tags[-1].end():]).strip()
        for m in tags:
            entries.append((_tag_seconds(m), content))
    entries.sort(key=lambda e: e[0])
    return entries


def split_words(text: str) -> list[str]:
    return [w for w in re.split(r"\s+", text.strip()) if w]


def lines_from_lrc(entries: list[tuple[float, str]], duration: float | None = None, tail: float = 5.0) -> list[dict[str, Any]]:
    """Linhas com start/end; ignora linhas vazias (instrumentais) mas usa seu tempo como fim da anterior."""
    lines: list[dict[str, Any]] = []
    for i, (start, content) in enumerate(entries):
        if not content:
            continue
        end = entries[i + 1][0] if i + 1 < len(entries) else start + tail
        if duration:
            end = min(end, duration)
        if end <= start:
            end = start + 0.5
        lines.append({"start": round(start, 3), "end": round(end, 3), "text": content})
    return lines


def lines_from_plain(text: str) -> list[str]:
    return [ln.strip() for ln in text.splitlines() if ln.strip()]


def spread_words(words: list[str], start: float, end: float) -> list[dict[str, Any]]:
    """Distribui as palavras no intervalo proporcionalmente ao nº de caracteres."""
    if not words:
        return []
    weights = [max(len(w), 1) for w in words]
    total = sum(weights)
    out: list[dict[str, Any]] = []
    cursor = start
    for w, weight in zip(words, weights):
        span = (end - start) * weight / total
        out.append({"text": w, "start": round(cursor, 3), "end": round(cursor + span, 3)})
        cursor += span
    return out


def fill_missing_times(words: list[dict[str, Any]], start: float, end: float) -> list[dict[str, Any]]:
    """Interpola tempos de palavras que o alinhador não conseguiu posicionar."""
    n = len(words)
    i = 0
    while i < n:
        if words[i].get("start") is not None and words[i].get("end") is not None:
            i += 1
            continue
        j = i
        while j < n and (words[j].get("start") is None or words[j].get("end") is None):
            j += 1
        left = words[i - 1]["end"] if i > 0 else start
        right = words[j]["start"] if j < n else end
        if right < left:
            right = left
        group = [w["text"] for w in words[i:j]]
        for w, filled in zip(words[i:j], spread_words(group, left, right)):
            w["start"], w["end"] = filled["start"], filled["end"]
        i = j
    return words


def make_line(words: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "start": round(words[0]["start"], 3),
        "end": round(words[-1]["end"], 3),
        "text": " ".join(w["text"] for w in words),
        "words": [{"text": w["text"], "start": round(w["start"], 3), "end": round(w["end"], 3)} for w in words],
    }


def normalize_monotonic(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Garante start<=end dentro das palavras e ordem crescente entre palavras."""
    last = 0.0
    for line in lines:
        for w in line["words"]:
            w["start"] = max(w["start"], last)
            w["end"] = max(w["end"], w["start"])
            last = w["end"]
        line["start"] = line["words"][0]["start"]
        line["end"] = line["words"][-1]["end"]
    return lines
