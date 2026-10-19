"""CLI do worker.

    python -m worker.process <URL do YouTube | arquivo de áudio> --out <pasta>

Cada etapa só roda se a saída ainda não existir (cache); use --force para refazer
tudo ou --only lyrics para refazer apenas a letra. Eventos de progresso saem como
JSON, um por linha, no stdout; logs vão para o stderr.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
from pathlib import Path

from . import config, progress
from .progress import emit, stage_reporter


def _norm(s: str | None) -> str:
    return "".join(ch for ch in (s or "").lower() if ch.isalnum())


def _fix_metadata(meta: dict, match: dict) -> tuple[str, str]:
    """Usa o título/artista do LRCLIB quando o do YouTube veio com os papéis trocados."""
    title, artist = meta.get("title", ""), meta.get("artist", "")
    if _norm(title) == _norm(match.get("artist")) and _norm(artist) == _norm(match.get("title")):
        return match["title"], match["artist"]
    return title, artist


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="worker.process", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("input", nargs="?", help="URL do YouTube ou caminho de um arquivo de áudio/vídeo")
    ap.add_argument("--out", required=True, type=Path, help="pasta de saída (ex.: data/songs/<id>)")
    ap.add_argument("--title", help="título (senão é detectado)")
    ap.add_argument("--artist", help="artista (senão é detectado)")
    ap.add_argument("--lyrics-file", type=Path, help="letra (texto puro ou LRC) para alinhar contra o vocal")
    ap.add_argument("--device", help="auto | cuda | mps | cpu (padrão: KARAOKE_DEVICE ou auto)")
    ap.add_argument("--only", choices=["lyrics"], help="refaz só a letra, reaproveitando os stems")
    ap.add_argument("--no-lyrics", action="store_true", help="pula a etapa de letra")
    ap.add_argument("--force", action="store_true", help="ignora o cache e refaz tudo")
    args = ap.parse_args(argv)

    progress.install()
    config.setup()
    out: Path = args.out
    out.mkdir(parents=True, exist_ok=True)
    meta_path = out / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}

    try:
        device = config.resolve_device(args.device)
        emit("info", device=device)
        t0 = time.time()

        # 1. Ingestão
        wav = out / "original.wav"
        if not args.only and (args.force or not wav.exists()):
            if not args.input:
                ap.error("informe a URL ou o arquivo de entrada")
            from .ingest import ingest

            meta.update(ingest(args.input, out, stage_reporter("downloading")))
            emit("meta", **{k: meta.get(k) for k in ("title", "artist", "duration", "has_cover")})
        if args.title:
            meta["title"] = args.title
        if args.artist is not None:
            meta["artist"] = args.artist
        if not wav.exists():
            raise FileNotFoundError(f"{wav} não existe; rode sem --only primeiro")
        meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

        # 2. Separação
        vocals, instrumental = out / "vocals.wav", out / "instrumental.wav"
        if not args.only and (args.force or not (vocals.exists() and instrumental.exists())):
            from .separate import separate

            separate(wav, out, device, stage_reporter("separating"))
        else:
            stage_reporter("separating")(1.0, "Stems em cache")

        # 3. Letra
        lyrics_path = out / "lyrics.json"
        if not args.no_lyrics and (args.force or args.only == "lyrics" or args.lyrics_file or not lyrics_path.exists()):
            from .lyrics import build_lyrics

            text = args.lyrics_file.read_text(encoding="utf-8") if args.lyrics_file else None
            reporters = {s: stage_reporter(s) for s in ("lyrics", "aligning")}
            result = build_lyrics(
                vocals,
                meta.get("title", ""),
                meta.get("artist", ""),
                meta.get("duration"),
                device,
                text,
                lambda stage, f, m: reporters[stage](f, m),
            )
            match = result.pop("match", None)
            if match and match.get("title"):
                meta["title"], meta["artist"] = _fix_metadata(meta, match)
            lyrics_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
            meta["language"] = result["language"]
            meta["lyrics_source"] = result["source"]
            meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

        emit("done", seconds=round(time.time() - t0, 1), meta=meta, out=str(out))
        return 0
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        traceback.print_exc()
        emit("error", message=f"{type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
