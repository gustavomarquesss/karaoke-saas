from worker.lrc import (
    fill_missing_times,
    lines_from_lrc,
    normalize_monotonic,
    parse_lrc,
    spread_words,
)

SAMPLE = """[ar:Artista]
[ti:Música]
[00:12.50] Primeira linha
[00:15.00]
[00:20.25][01:00.5] Refrão aqui
[01:05.00] <01:05.10>Última <01:05.50>linha
"""


def test_parse_lrc_basic():
    entries = parse_lrc(SAMPLE)
    assert entries[0] == (12.5, "Primeira linha")
    assert (15.0, "") in entries
    # tags repetidas geram duas entradas, em ordem
    assert [t for t, c in entries if c == "Refrão aqui"] == [20.25, 60.5]
    assert entries[-1] == (65.0, "Última linha")


def test_lines_from_lrc_skips_empty_and_uses_gap_as_end():
    lines = lines_from_lrc(parse_lrc(SAMPLE))
    assert lines[0]["text"] == "Primeira linha"
    assert lines[0]["end"] == 15.0  # a linha vazia termina a anterior
    assert all(l["text"] for l in lines)


def test_lines_from_lrc_clamps_to_duration():
    lines = lines_from_lrc([(10.0, "a"), (20.0, "b")], duration=22.0, tail=10.0)
    assert lines[-1]["end"] == 22.0


def test_spread_words_proportional():
    words = spread_words(["a", "bbb"], 0.0, 4.0)
    assert words[0]["start"] == 0.0 and words[0]["end"] == 1.0
    assert words[1]["end"] == 4.0


def test_fill_missing_times_interpolates():
    words = [
        {"text": "um", "start": 1.0, "end": 1.5},
        {"text": "dois"},
        {"text": "três"},
        {"text": "quatro", "start": 3.0, "end": 3.5},
    ]
    fill_missing_times(words, 0.0, 5.0)
    assert 1.5 <= words[1]["start"] < words[1]["end"] <= words[2]["start"]
    assert words[2]["end"] <= 3.0


def test_normalize_monotonic():
    lines = [
        {"start": 0, "end": 2, "words": [{"text": "a", "start": 0, "end": 2}]},
        {"start": 1, "end": 3, "words": [{"text": "b", "start": 1, "end": 3}]},
    ]
    normalize_monotonic(lines)
    assert lines[1]["words"][0]["start"] == 2
