"""Exporta um MP4 de karaokê (letra queimada + instrumental).

    python -m worker.export data/songs/<id> --out karaoke.mp4 [--vocal 0.2] [--semitones -2] [--tempo 0.9]

A letra vira um arquivo ASS com efeito de karaokê (\\kf) por palavra, renderizado pelo ffmpeg (libass).
Tom e velocidade usam o filtro `rubberband` do ffmpeg quando diferentes do padrão.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

from . import config
from .progress import emit, install

SUNG = "&H006BF5C9&"  # lima (ASS usa BGR): #C9F56B
UNSUNG = "&H00F2FAEE&"  # quase branco esverdeado
OUTLINE = "&H000C1107&"


def ass_time(t: float) -> str:
    t = max(t, 0.0)
    cs = int(round(t * 100))
    h, rem = divmod(cs, 360000)
    m, rem = divmod(rem, 6000)
    s, c = divmod(rem, 100)
    return f"{h}:{m:02d}:{s:02d}.{c:02d}"


def escape(text: str) -> str:
    return text.replace("\\", "").replace("{", "(").replace("}", ")")


def build_ass(lyrics: dict, width: int, height: int, offset_ms: int = 0, tempo: float = 1.0, lead: float = 4.0, title: str = "") -> str:
    """Duas linhas alternadas (estilo karaokê clássico): a próxima já aparece enquanto a atual é cantada."""
    lines = [ln for ln in lyrics.get("lines", []) if ln.get("words")]
    scale = 1.0 / max(tempo, 0.01)
    shift = offset_ms / 1000.0

    def t(x: float) -> float:
        return (x + shift) * scale

    font_size = max(int(height * 0.085), 28)
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 0
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Karaoke,Arial,{font_size},{SUNG},{UNSUNG},{OUTLINE},&H80000000&,-1,0,0,0,100,100,0,0,1,{max(font_size // 14, 2)},1,5,{int(width * 0.05)},{int(width * 0.05)},0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    events: list[str] = []
    y = (int(height * 0.40), int(height * 0.62))  # duas "faixas" verticais
    for i, line in enumerate(lines):
        start, end = t(line["start"]), t(line["end"])
        prev_same_slot_end = t(lines[i - 2]["end"]) + 0.1 if i >= 2 else 0.0
        show = max(prev_same_slot_end, start - lead * scale, 0.0)
        if i >= 1:  # nunca antes de a linha anterior (outra faixa) já estar à vista
            show = max(show, min(start, t(lines[i - 1]["start"])))
        hide = end + 0.5
        parts = []
        for w in line["words"]:
            dur = max(int(round((w["end"] - w["start"]) * scale * 100)), 1)
            # \kf = preenchimento suave; o gap até a próxima palavra entra como \k vazio
            parts.append(f"{{\\kf{dur}}}{escape(w['text'])}")
        # tempo parado entre o início da exibição e o início do canto: \k inicial
        pre = int(round((start - show) * 100))
        text = f"{{\\pos({width // 2},{y[i % 2]})\\k{max(pre, 0)}}}" + " ".join(parts)
        events.append(f"Dialogue: 0,{ass_time(show)},{ass_time(hide)},Karaoke,,0,0,0,,{text}")
    if title:
        events.append(f"Dialogue: 1,{ass_time(0)},{ass_time(4)},Karaoke,,0,0,0,,{{\\pos({width // 2},{int(height * 0.12)})\\fs{font_size // 2}\\fad(300,600)}}{escape(title)}")
    return header + "\n".join(events) + "\n"


def run_export(song_dir: Path, out: Path, vocal: float = 0.0, instrumental: float = 1.0, semitones: int = 0, tempo: float = 1.0,
               offset_ms: int = 0, size: str = "1280x720", title: str = "") -> Path:
    ffmpeg = config.ensure_ffmpeg()
    width, height = (int(x) for x in size.lower().split("x"))
    lyrics_path = song_dir / "lyrics.json"
    if not lyrics_path.exists():
        raise FileNotFoundError("a música não tem letra (lyrics.json)")
    lyrics = json.loads(lyrics_path.read_text(encoding="utf-8"))
    ass_path = out.with_suffix(".ass")
    ass_path.write_text(build_ass(lyrics, width, height, offset_ms, tempo, title=title), encoding="utf-8")

    cover = song_dir / "cover.jpg"
    inst, voc = song_dir / "instrumental.wav", song_dir / "vocals.wav"
    import soundfile as sf

    duration = max(sf.info(str(inst)).duration, 1.0)

    # filtro de áudio: mistura (volumes) → rubberband (tom/velocidade)
    afilters = []
    mix = f"[1:a]volume={instrumental}[ia];[2:a]volume={vocal}[va];[ia][va]amix=inputs=2:duration=longest:normalize=0"
    if semitones or abs(tempo - 1) > 1e-3:
        mix += f",rubberband=pitch={2 ** (semitones / 12):.6f}:tempo={tempo:.4f}"
    afilters.append(mix + "[a]")

    ass_arg = str(ass_path).replace("\\", "/").replace(":", "\\:")
    bg_png = out.with_suffix(".bg.png")
    if cover.exists():
        # o fundo (capa desfocada) é renderizado UMA vez; depois o ffmpeg só repete a imagem
        subprocess.run([ffmpeg, "-y", "-v", "error", "-i", str(cover), "-frames:v", "1", "-vf",
                        f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height},"
                        "boxblur=24:4,eq=brightness=-0.32:saturation=0.9", str(bg_png)], check=True)
        bg = ["-loop", "1", "-framerate", "30", "-i", str(bg_png)]
        vf = f"[0:v]ass='{ass_arg}'[v]"
    else:
        bg = ["-f", "lavfi", "-i", f"color=c=0x07110c:s={width}x{height}:r=30"]
        vf = f"[0:v]ass='{ass_arg}'[v]"

    cmd = [ffmpeg, "-y", "-v", "error", "-progress", "pipe:1", "-nostats", *bg, "-i", str(inst), "-i", str(voc),
           "-filter_complex", f"{vf};{';'.join(afilters)}", "-map", "[v]", "-map", "[a]",
           "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k",
           "-shortest", "-movflags", "+faststart", str(out)]
    # -shortest com imagem em loop: limita pela duração do áudio
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace")
    total = max(duration / max(tempo, 0.01), 1.0)
    assert proc.stdout is not None
    for raw in proc.stdout:
        m = re.match(r"out_time_us=(\d+)", raw)
        if m:
            emit("progress", stage="exporting", progress=min(int(m.group(1)) / 1e6 / total, 0.99), message="Gerando vídeo")
    err = proc.stderr.read() if proc.stderr else ""
    if proc.wait() != 0:
        raise RuntimeError(f"ffmpeg falhou: {err.strip()[-600:]}")
    ass_path.unlink(missing_ok=True)
    bg_png.unlink(missing_ok=True)
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="worker.export", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("song_dir", type=Path)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--vocal", type=float, default=0.0, help="volume da voz guia (0–1)")
    ap.add_argument("--instrumental", type=float, default=1.0)
    ap.add_argument("--semitones", type=int, default=0)
    ap.add_argument("--tempo", type=float, default=1.0)
    ap.add_argument("--offset-ms", type=int, default=0)
    ap.add_argument("--size", default="1280x720")
    ap.add_argument("--title", default="")
    a = ap.parse_args(argv)
    install()
    config.setup()
    try:
        a.out.parent.mkdir(parents=True, exist_ok=True)
        run_export(a.song_dir, a.out, a.vocal, a.instrumental, a.semitones, a.tempo, a.offset_ms, a.size, a.title)
        emit("done", seconds=0, meta={"file": a.out.name}, out=str(a.out))
        return 0
    except Exception as exc:  # noqa: BLE001
        emit("error", message=f"{type(exc).__name__}: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
