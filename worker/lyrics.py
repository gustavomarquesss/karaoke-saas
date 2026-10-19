"""Letra: LRCLIB → (alinhamento por palavra) ou transcrição WhisperX / faster-whisper."""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable

import numpy as np
import soundfile as sf

from . import lrc
from .config import compute_type, whisper_model_name

ProgressFn = Callable[[float, str], None]
LRCLIB = "https://lrclib.net/api"
USER_AGENT = "karaoke-local/0.1 (https://github.com/local/karaoke)"
SAMPLE_RATE = 16000


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


# ----------------------------------------------------------------- LRCLIB

def _http_json(url: str, timeout: float = 15.0) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def fetch_lrclib(title: str, artist: str, duration: float | None, swapped: bool = False) -> dict | None:
    """Busca letra sincronizada. Devolve o registro do LRCLIB ou None."""
    if not title:
        return None
    candidates: list[dict] = []
    try:
        params = {"track_name": title, "artist_name": artist or ""}
        if duration:
            params["duration"] = str(int(round(duration)))
        candidates.append(_http_json(f"{LRCLIB}/get?{urllib.parse.urlencode(params)}"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ConnectionError) as exc:
        log(f"LRCLIB /get sem resultado: {exc}")
    if not candidates:
        try:
            q = f"{artist} {title}".strip()
            results = _http_json(f"{LRCLIB}/search?{urllib.parse.urlencode({'q': q})}")
            candidates.extend(results)
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ConnectionError) as exc:
            log(f"LRCLIB /search falhou: {exc}")
    synced = [c for c in candidates if c.get("syncedLyrics")]
    if not synced and artist and not swapped:
        # "Título - Artista" é comum no YouTube; tenta com os papéis trocados.
        return fetch_lrclib(artist, title, duration, swapped=True)
    if not synced:
        return None
    if duration:  # prefere a versão com duração mais próxima; descarta as muito diferentes
        synced.sort(key=lambda c: abs((c.get("duration") or 0) - duration))
        if abs((synced[0].get("duration") or 0) - duration) > 8:
            return None
    return synced[0]


# ----------------------------------------------------------------- áudio / idioma

def load_audio_16k(path: Path) -> np.ndarray:
    data, sr = sf.read(str(path), dtype="float32", always_2d=True)
    mono = data.mean(axis=1)
    if sr != SAMPLE_RATE:
        import torch
        import torchaudio

        mono = torchaudio.functional.resample(torch.from_numpy(mono), sr, SAMPLE_RATE).numpy()
    return mono.astype("float32")


def vocal_span(audio: np.ndarray, threshold_db: float = -40.0) -> tuple[float, float]:
    """Primeiro e último instante com voz (energia RMS por janelas de 0,5 s)."""
    win = SAMPLE_RATE // 2
    n = len(audio) // win
    if n == 0:
        return 0.0, len(audio) / SAMPLE_RATE
    rms = np.sqrt((audio[: n * win].reshape(n, win) ** 2).mean(axis=1) + 1e-12)
    db = 20 * np.log10(rms + 1e-12)
    active = np.where(db > max(threshold_db, db.max() - 35))[0]
    if len(active) == 0:
        return 0.0, len(audio) / SAMPLE_RATE
    return float(active[0] * 0.5), float((active[-1] + 1) * 0.5)


def detect_language(audio: np.ndarray, device: str) -> str:
    forced = os.environ.get("LYRICS_LANGUAGE", "").strip()
    if forced:
        return forced
    from faster_whisper import WhisperModel

    start, end = vocal_span(audio)
    mid = (start + end) / 2
    a = int(max(0, mid - 15) * SAMPLE_RATE)
    clip = audio[a : a + 30 * SAMPLE_RATE]
    dev = "cuda" if device == "cuda" else "cpu"
    model = WhisperModel("base", device=dev, compute_type="float16" if dev == "cuda" else "int8")
    lang, prob, _ = model.detect_language(clip)
    log(f"Idioma detectado: {lang} ({prob:.2f})")
    del model
    return lang


# ----------------------------------------------------------------- alinhamento (wav2vec2 via WhisperX)

def _align_segments(segments: list[dict], audio: np.ndarray, language: str, device: str, on_progress: ProgressFn) -> list[dict]:
    """Roda o alinhador do WhisperX. Segmentos que falham ficam sem 'words'."""
    import whisperx

    dev = "cuda" if device == "cuda" else "cpu"  # o alinhador não roda em MPS de forma confiável
    on_progress(0.0, "Carregando modelo de alinhamento")
    model_a, metadata = whisperx.load_align_model(language_code=language, device=dev)
    on_progress(0.3, "Alinhando palavras")
    result = whisperx.align(segments, model_a, metadata, audio, dev, return_char_alignments=False)
    del model_a
    return result["segments"]


def _words_from_aligned(seg: dict, fallback_words: list[str], start: float, end: float) -> list[dict]:
    words = seg.get("words") or []
    if len(words) != len(fallback_words):
        return lrc.spread_words(fallback_words, start, end)
    out = [{"text": fallback_words[i], "start": w.get("start"), "end": w.get("end")} for i, w in enumerate(words)]
    return lrc.fill_missing_times(out, start, end)


def align_lines(lines: list[dict], audio: np.ndarray, language: str, device: str, on_progress: ProgressFn, pad: float = 0.4) -> list[dict]:
    """Tempo por palavra para linhas com start/end conhecidos (LRC ou segmentos Whisper)."""
    total_dur = len(audio) / SAMPLE_RATE
    segments = [
        {"text": ln["text"], "start": max(0.0, ln["start"] - pad), "end": min(total_dur, ln["end"] + pad)}
        for ln in lines
    ]
    try:
        aligned = _align_segments(segments, audio, language, device, on_progress)
    except Exception as exc:  # idioma sem modelo, falta de memória etc.
        log(f"Alinhamento falhou ({exc}); distribuindo palavras proporcionalmente.")
        aligned = [{} for _ in lines]
    out = []
    for ln, seg in zip(lines, aligned):
        words = lrc.split_words(ln["text"])
        if not words:
            continue
        out.append(lrc.make_line(_words_from_aligned(seg, words, ln["start"], ln["end"])))
    return lrc.normalize_monotonic(out)


def align_plain_text(text: str, audio: np.ndarray, language: str, device: str, on_progress: ProgressFn) -> list[dict]:
    """Forced alignment de uma letra sem tempos: um único segmento cobrindo a região cantada."""
    text_lines = lrc.lines_from_plain(text)
    flat_words = [w for ln in text_lines for w in lrc.split_words(ln)]
    start, end = vocal_span(audio)
    start, end = max(0.0, start - 0.5), min(len(audio) / SAMPLE_RATE, end + 0.5)
    try:
        aligned = _align_segments([{"text": " ".join(flat_words), "start": start, "end": end}], audio, language, device, on_progress)
        words = _words_from_aligned(aligned[0], flat_words, start, end)
    except Exception as exc:
        log(f"Forced alignment falhou ({exc}); distribuindo palavras proporcionalmente.")
        words = lrc.spread_words(flat_words, start, end)
    lines, i = [], 0
    for ln in text_lines:
        n = len(lrc.split_words(ln))
        lines.append(lrc.make_line(words[i : i + n]))
        i += n
    return lrc.normalize_monotonic(lines)


# ----------------------------------------------------------------- transcrição

def transcribe(audio: np.ndarray, device: str, on_progress: ProgressFn) -> tuple[list[dict], str]:
    """Transcreve com WhisperX (fallback: faster-whisper) e devolve linhas com palavras + idioma."""
    forced = os.environ.get("LYRICS_LANGUAGE", "").strip() or None
    try:
        return _transcribe_whisperx(audio, device, forced, on_progress)
    except Exception as exc:
        log(f"WhisperX falhou ({exc!r}); usando faster-whisper.")
        return _transcribe_faster_whisper(audio, device, forced, on_progress)


def _transcribe_whisperx(audio, device, language, on_progress):
    import whisperx

    dev = "cuda" if device == "cuda" else "cpu"
    name = whisper_model_name(dev)
    on_progress(0.0, f"Carregando Whisper ({name})")
    model = whisperx.load_model(name, dev, compute_type=compute_type(dev), language=language)
    on_progress(0.15, "Transcrevendo")
    result = model.transcribe(audio, batch_size=8 if dev == "cuda" else 1, language=language)
    lang = result["language"]
    del model
    segs = [s for s in result["segments"] if s["text"].strip()]
    on_progress(0.6, "Alinhando palavras")
    aligned = _align_segments(segs, audio, lang, device, lambda f, m: on_progress(0.6 + 0.4 * f, m))
    lines = []
    for src, seg in zip(segs, aligned):
        words = lrc.split_words(src["text"])
        if words:
            lines.append(lrc.make_line(_words_from_aligned(seg, words, src["start"], src["end"])))
    return lrc.normalize_monotonic(lines), lang


def _transcribe_faster_whisper(audio, device, language, on_progress):
    from faster_whisper import WhisperModel

    dev = "cuda" if device == "cuda" else "cpu"
    name = whisper_model_name(dev)
    on_progress(0.0, f"Carregando faster-whisper ({name})")
    model = WhisperModel(name, device=dev, compute_type=compute_type(dev))
    segments, info = model.transcribe(audio, language=language, word_timestamps=True, vad_filter=True, condition_on_previous_text=False)
    lines = []
    for seg in segments:
        words = [{"text": w.word.strip(), "start": w.start, "end": w.end} for w in (seg.words or []) if w.word.strip()]
        if words:
            lines.append(lrc.make_line(words))
        on_progress(min(seg.end / (len(audio) / SAMPLE_RATE), 1.0), "Transcrevendo")
    return lrc.normalize_monotonic(lines), info.language


# ----------------------------------------------------------------- orquestração

def build_lyrics(
    vocals_path: Path,
    title: str,
    artist: str,
    duration: float | None,
    device: str,
    lyrics_text: str | None,
    on_progress: Callable[[str, float, str], None],
) -> dict:
    """Escolhe a melhor fonte de letra. `on_progress(stage, fração, mensagem)`."""
    audio = load_audio_16k(vocals_path)
    lyr = lambda f, m: on_progress("lyrics", f, m)  # noqa: E731
    ali = lambda f, m: on_progress("aligning", f, m)  # noqa: E731

    if lyrics_text and lyrics_text.strip():
        lyr(0.1, "Detectando idioma")
        language = detect_language(audio, device)
        entries = lrc.parse_lrc(lyrics_text)
        if entries:
            lines = lrc.lines_from_lrc(entries, duration)
            return {"language": language, "source": "manual", "lines": align_lines(lines, audio, language, device, ali)}
        return {"language": language, "source": "manual", "lines": align_plain_text(lyrics_text, audio, language, device, ali)}

    lyr(0.1, "Buscando letra no LRCLIB")
    record = fetch_lrclib(title, artist, duration)
    if record:
        lyr(0.6, "Letra sincronizada encontrada")
        language = detect_language(audio, device)
        lines = lrc.lines_from_lrc(lrc.parse_lrc(record["syncedLyrics"]), duration)
        return {
            "language": language,
            "source": "lrclib",
            "lines": align_lines(lines, audio, language, device, ali),
            "match": {"title": record.get("trackName"), "artist": record.get("artistName")},
        }

    lyr(0.8, "Sem letra no LRCLIB; transcrevendo")
    lines, language = transcribe(audio, device, ali)
    return {"language": language, "source": "whisperx", "lines": lines}
