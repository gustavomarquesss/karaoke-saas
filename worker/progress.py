"""Protocolo de progresso: uma linha JSON por evento no stdout real do processo.

Bibliotecas de IA imprimem lixo no stdout; por isso `install()` redireciona o
`sys.stdout` para o stderr e guarda o stdout original só para os eventos.
"""
from __future__ import annotations

import json
import sys
from typing import Any, Callable

_out = sys.stdout


def install() -> None:
    global _out
    _out = sys.stdout
    sys.stdout = sys.stderr


def emit(event: str, **fields: Any) -> None:
    _out.write(json.dumps({"event": event, **fields}, ensure_ascii=False) + "\n")
    _out.flush()


# Faixa de progresso global ocupada por cada etapa (0..1).
STAGES = {
    "downloading": (0.00, 0.10),
    "separating": (0.10, 0.50),
    "lyrics": (0.50, 0.70),
    "aligning": (0.70, 0.98),
}

ProgressFn = Callable[[str, float, str], None]


def stage_reporter(stage: str) -> Callable[[float, str], None]:
    lo, hi = STAGES[stage]

    def report(fraction: float, message: str = "") -> None:
        fraction = max(0.0, min(1.0, fraction))
        emit("progress", stage=stage, progress=round(lo + (hi - lo) * fraction, 4), message=message)

    return report
