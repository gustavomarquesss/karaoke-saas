"""Configuração do worker: .env, dispositivo de IA e localização do ffmpeg."""
from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
BIN_DIR = ROOT / "worker" / ".bin"


def load_env() -> None:
    """Carrega o .env da raiz (sem sobrescrever variáveis já definidas)."""
    env_file = ROOT / ".env"
    if not env_file.exists():
        return
    for raw in env_file.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def ensure_ffmpeg() -> str:
    """Garante um `ffmpeg` no PATH. Usa o do sistema ou o binário do imageio-ffmpeg."""
    found = shutil.which("ffmpeg")
    if found:
        return found
    import imageio_ffmpeg

    src = Path(imageio_ffmpeg.get_ffmpeg_exe())
    BIN_DIR.mkdir(parents=True, exist_ok=True)
    dst = BIN_DIR / ("ffmpeg.exe" if sys.platform == "win32" else "ffmpeg")
    if not dst.exists():
        shutil.copy2(src, dst)
        dst.chmod(0o755)
    os.environ["PATH"] = str(BIN_DIR) + os.pathsep + os.environ.get("PATH", "")
    return str(dst)


def resolve_device(preferred: str | None = None) -> str:
    """auto → cuda, mps ou cpu (nessa ordem)."""
    choice = (preferred or os.environ.get("KARAOKE_DEVICE") or "auto").lower()
    if choice != "auto":
        return choice
    import torch

    if torch.cuda.is_available():
        return "cuda"
    mps = getattr(torch.backends, "mps", None)
    if mps is not None and mps.is_available():
        return "mps"
    return "cpu"


def compute_type(device: str) -> str:
    choice = (os.environ.get("WHISPER_COMPUTE_TYPE") or "auto").lower()
    if choice != "auto":
        return choice
    return "float16" if device == "cuda" else "int8"


def whisper_model_name(device: str) -> str:
    name = os.environ.get("WHISPER_MODEL")
    if name:
        return name
    return "large-v3" if device == "cuda" else "small"


def setup() -> None:
    load_env()
    ensure_ffmpeg()
    # Evita aviso de symlink do HF no Windows e mantém modelos fora do git.
    os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
