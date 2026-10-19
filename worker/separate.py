"""Separação vocal/instrumental com Demucs (htdemucs), via API Python."""
from __future__ import annotations

from pathlib import Path
from typing import Callable

import numpy as np
import soundfile as sf


def separate(wav_path: Path, out_dir: Path, device: str, on_progress: Callable[[float, str], None]) -> None:
    """Gera `vocals.wav` e `instrumental.wav` (= soma de drums+bass+other)."""
    import torch
    from demucs.apply import apply_model
    from demucs.pretrained import get_model

    on_progress(0.0, "Carregando modelo htdemucs")
    model = get_model("htdemucs")
    model.eval()

    audio, sr = sf.read(str(wav_path), dtype="float32", always_2d=True)  # (n, ch)
    wav = torch.from_numpy(audio.T.copy())  # (ch, n)
    if sr != model.samplerate:
        import torchaudio

        wav = torchaudio.functional.resample(wav, sr, model.samplerate)
        sr = model.samplerate
    if wav.shape[0] == 1:
        wav = wav.repeat(2, 1)

    ref = wav.mean(0)
    mix = (wav - ref.mean()) / (ref.std() + 1e-8)

    # apply_model reporta progresso por segmento via barra tqdm; usamos o callback do tqdm.
    on_progress(0.05, "Separando vocal e instrumental")
    sources = _apply_with_progress(apply_model, model, mix, device, on_progress)
    sources = sources * (ref.std() + 1e-8) + ref.mean()

    names = list(model.sources)
    vocals = sources[names.index("vocals")]
    instrumental = sum(sources[i] for i, n in enumerate(names) if n != "vocals")

    out_dir.mkdir(parents=True, exist_ok=True)
    for name, tensor in (("vocals", vocals), ("instrumental", instrumental)):
        data = tensor.cpu().numpy().T
        peak = float(np.max(np.abs(data))) if data.size else 0.0
        if peak > 1.0:  # evita clipping
            data = data / peak
        sf.write(str(out_dir / f"{name}.wav"), data, sr, subtype="PCM_16")
    on_progress(1.0, "Separação concluída")


def _apply_with_progress(apply_model, model, mix, device: str, on_progress):
    import tqdm

    original = tqdm.tqdm

    class ProgressTqdm(original):  # type: ignore[misc, valid-type]
        def update(self, n=1):
            super().update(n)
            if self.total:
                on_progress(0.05 + 0.93 * min(self.n / self.total, 1.0), "Separando vocal e instrumental")

    # demucs.apply importa tqdm no módulo; troca temporariamente.
    import demucs.apply as da

    prev = da.tqdm.tqdm if hasattr(da, "tqdm") else None
    if prev is not None:
        da.tqdm.tqdm = ProgressTqdm
    try:
        import torch

        with torch.no_grad():
            out = apply_model(model, mix[None], device=device, shifts=1, split=True, overlap=0.25, progress=True)[0]
    finally:
        if prev is not None:
            da.tqdm.tqdm = prev
    return out
