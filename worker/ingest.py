"""Ingestão: URL do YouTube (yt-dlp) ou arquivo local → WAV 44.1 kHz estéreo."""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Callable

import soundfile as sf

from .config import ensure_ffmpeg

URL_RE = re.compile(r"^https?://", re.I)


def is_url(value: str) -> bool:
    return bool(URL_RE.match(value))


def split_artist_title(raw_title: str, uploader: str | None = None) -> tuple[str, str]:
    """'Artista - Título (Official Video)' → (artista, título)."""
    cleaned = re.sub(r"\s*[\(\[][^\)\]]*(official|oficial|video|vídeo|lyrics|letra|audio|áudio|clipe|4k|hd)[^\)\]]*[\)\]]", "", raw_title, flags=re.I)
    cleaned = cleaned.strip(" -–—")
    for sep in (" - ", " – ", " — "):
        if sep in cleaned:
            artist, _, title = cleaned.partition(sep)
            return artist.strip(), title.strip()
    artist = re.sub(r"\s*-\s*Topic$", "", uploader or "", flags=re.I).strip()
    return artist, cleaned


def to_wav(src: Path, dst: Path) -> None:
    ffmpeg = ensure_ffmpeg()
    cmd = [ffmpeg, "-y", "-v", "error", "-i", str(src), "-vn", "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", str(dst)]
    subprocess.run(cmd, check=True)


def download_youtube(url: str, workdir: Path, on_progress: Callable[[float, str], None]) -> dict:
    """Baixa o melhor áudio com yt-dlp e devolve metadados."""
    import yt_dlp

    ffmpeg = ensure_ffmpeg()

    def hook(d: dict) -> None:
        if d.get("status") == "downloading":
            total = d.get("total_bytes") or d.get("total_bytes_estimate") or 0
            if total:
                on_progress(d.get("downloaded_bytes", 0) / total * 0.9, "Baixando áudio")

    opts = {
        "format": "bestaudio/best",
        "outtmpl": str(workdir / "source.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "ffmpeg_location": str(Path(ffmpeg).parent),
        "progress_hooks": [hook],
        "writethumbnail": True,
        "postprocessors": [{"key": "FFmpegThumbnailsConvertor", "format": "jpg"}],
    }
    with yt_dlp.YoutubeDL(opts) as ydl:
        info = ydl.extract_info(url, download=True)
    return {
        "raw_title": info.get("track") or info.get("title") or "Sem título",
        "uploader": info.get("artist") or info.get("uploader"),
        "duration": info.get("duration"),
        "source_url": info.get("webpage_url") or url,
    }


def ingest(source: str, out_dir: Path, on_progress: Callable[[float, str], None]) -> dict:
    """Produz `<out>/original.wav`, `cover.jpg` (se houver) e devolve os metadados."""
    out_dir.mkdir(parents=True, exist_ok=True)
    work = out_dir / "_source"
    work.mkdir(exist_ok=True)

    if is_url(source):
        meta = download_youtube(source, work, on_progress)
        audio = next(p for p in work.iterdir() if p.stem == "source" and p.suffix not in (".jpg", ".png", ".webp"))
        thumb = next((p for p in work.iterdir() if p.suffix == ".jpg"), None)
        artist, title = split_artist_title(meta["raw_title"], meta["uploader"])
    else:
        audio = Path(source)
        if not audio.exists():
            raise FileNotFoundError(f"Arquivo não encontrado: {audio}")
        thumb = None
        artist, title = "", audio.stem
        meta = {"source_url": None}

    on_progress(0.92, "Convertendo para WAV")
    wav = out_dir / "original.wav"
    to_wav(audio, wav)
    if thumb:
        (out_dir / "cover.jpg").write_bytes(thumb.read_bytes())

    duration = sf.info(str(wav)).duration
    if is_url(source):
        for p in work.iterdir():
            p.unlink()
        work.rmdir()
    else:
        work.rmdir()
    on_progress(1.0, "Áudio pronto")
    return {
        "title": title,
        "artist": artist,
        "duration": round(duration, 3),
        "source_url": meta.get("source_url"),
        "has_cover": thumb is not None,
    }


if __name__ == "__main__":  # pequeno teste manual
    print(json.dumps(split_artist_title(sys.argv[1]), ensure_ascii=False))
