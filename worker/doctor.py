"""Diagnóstico do ambiente do worker: `python -m worker.doctor`."""
from __future__ import annotations

import importlib.metadata as md
import platform
import sys

from . import config


def version(pkg: str) -> str:
    try:
        return md.version(pkg)
    except md.PackageNotFoundError:
        return "NÃO INSTALADO"


def main() -> int:
    config.load_env()
    ok = True
    print(f"python        {platform.python_version()} ({sys.executable})")
    if sys.version_info < (3, 11):
        print("  ! precisa de Python 3.11+")
        ok = False
    try:
        import torch

        device = config.resolve_device()
        print(f"torch         {torch.__version__}")
        print(f"dispositivo   {device}" + (f" ({torch.cuda.get_device_name(0)})" if device == "cuda" else ""))
        if device == "cpu":
            print("  ! sem GPU: funciona, mas a separação e a transcrição ficam bem mais lentas")
    except Exception as exc:  # noqa: BLE001
        print(f"torch         ERRO: {exc}")
        ok = False
    for pkg in ("demucs", "whisperx", "faster-whisper", "yt-dlp", "soundfile", "imageio-ffmpeg"):
        v = version(pkg)
        print(f"{pkg:<13} {v}")
        ok &= v != "NÃO INSTALADO"
    try:
        print(f"ffmpeg        {config.ensure_ffmpeg()}")
    except Exception as exc:  # noqa: BLE001
        print(f"ffmpeg        ERRO: {exc}")
        ok = False
    print("\nTudo certo." if ok else "\nHá problemas acima; veja a seção 'Solução de problemas' do README.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
