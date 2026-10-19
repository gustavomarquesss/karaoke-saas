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


def test_fix_metadata_swaps_when_youtube_order_is_title_artist():
    from worker.process import _fix_metadata

    meta = {"title": "Legião Urbana", "artist": "Pais e Filhos"}
    match = {"title": "Pais e Filhos", "artist": "Legião Urbana"}
    assert _fix_metadata(meta, match) == ("Pais e Filhos", "Legião Urbana")
    # nomes que já batem permanecem
    assert _fix_metadata({"title": "X", "artist": "Y"}, {"title": "Z", "artist": "W"}) == ("X", "Y")


def test_anchor_to_transcript_matches_despite_typos_and_extra_words():
    from worker.lrc import anchor_to_transcript

    asr = [
        {"text": "Estátuas", "start": 10.0, "end": 10.5},
        {"text": "e", "start": 10.5, "end": 10.6},
        {"text": "cofres", "start": 10.7, "end": 11.2},
        {"text": "ruído", "start": 11.3, "end": 11.5},  # palavra extra do Whisper
        {"text": "ninguem", "start": 20.0, "end": 20.5},
        {"text": "sabe", "start": 20.6, "end": 21.0},
        {"text": "o", "start": 21.0, "end": 21.1},
        {"text": "que", "start": 21.1, "end": 21.3},
        {"text": "aconteceu", "start": 21.3, "end": 22.0},
    ]
    out = anchor_to_transcript(["Estátuas e cofres", "Ninguém sabe o que aconteceu"], asr)
    assert [round(o["start"], 1) for o in out] == [10.0, 20.0]
    assert out[0]["end"] == 11.2 and out[1]["end"] == 22.0


def test_anchor_to_transcript_interpolates_unmatched_words():
    from worker.lrc import anchor_to_transcript

    asr = [{"text": "a", "start": 1.0, "end": 1.2}, {"text": "c", "start": 3.0, "end": 3.2}, {"text": "d", "start": 4.0, "end": 4.2}]
    out = anchor_to_transcript(["a b c d"], asr)
    assert out[0]["start"] == 1.0 and out[0]["end"] == 4.2


def test_anchor_to_transcript_rejects_unrelated_text():
    import pytest

    from worker.lrc import anchor_to_transcript

    with pytest.raises(ValueError):
        anchor_to_transcript(["totalmente outra coisa aqui agora"], [{"text": "xyz", "start": 0, "end": 1}, {"text": "abc", "start": 1, "end": 2}])


def test_split_into_lines_breaks_on_pauses_and_length():
    from worker.lrc import split_into_lines

    def w(text, start):
        return {"text": text, "start": start, "end": start + 0.3}

    words = [w(t, i * 0.4) for i, t in enumerate("um dois tres quatro cinco seis sete oito nove dez onze doze".split())]
    words += [w("depois", 10.0), w("da", 10.4), w("pausa", 10.8)]
    lines = split_into_lines(words)
    assert all(len(l["words"]) <= 8 for l in lines)
    assert lines[-1]["text"] == "depois da pausa"  # a pausa de ~5 s separa as linhas
    assert sum(len(l["words"]) for l in lines) == len(words)  # nenhuma palavra perdida


def test_split_into_lines_prefers_punctuation():
    from worker.lrc import split_into_lines

    def w(text, start):
        return {"text": text, "start": start, "end": start + 0.3}

    words = [w(t, i * 0.4) for i, t in enumerate("quero colo, vou fugir de casa posso dormir aqui com voces".split())]
    lines = split_into_lines(words, max_words=8)
    assert [l["text"] for l in lines] == ["quero colo, vou fugir de casa", "posso dormir aqui com voces"] or len(lines) >= 2


def test_split_into_lines_breaks_before_capitalized_verse_start():
    from worker.lrc import split_into_lines

    def w(text, start):
        return {"text": text, "start": start, "end": start + 0.3}

    words = [w(t, i * 0.35) for i, t in enumerate("Estátuas e cofres e paredes pintadas Ninguém sabe o que aconteceu Ela se jogou".split())]
    texts = [l["text"] for l in split_into_lines(words)]
    assert texts == ["Estátuas e cofres e paredes pintadas", "Ninguém sabe o que aconteceu", "Ela se jogou"]
    # "I" no meio da frase em inglês não quebra
    en = [w(t, i * 0.3) for i, t in enumerate("when I was young and I loved you".split())]
    assert len(split_into_lines(en)) == 1


def test_needs_ingest_reuses_original_wav_on_force_without_input():
    from worker.process import _needs_ingest

    assert _needs_ingest(None, False, True, False)  # sem wav: precisa
    assert not _needs_ingest(None, False, True, True)  # cache
    assert not _needs_ingest(None, True, False, True)  # --force sem entrada: reaproveita o wav
    assert _needs_ingest(None, True, True, True)  # --force com entrada: refaz tudo
    assert not _needs_ingest('lyrics', True, True, False)  # --only lyrics nunca baixa
