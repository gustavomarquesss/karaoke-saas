# Karaokê pessoal com IA

Cole um link do YouTube (ou envie um arquivo de áudio) e o app, rodando **100% na sua máquina**:

1. baixa e converte o áudio (`yt-dlp` + `ffmpeg`);
2. separa **vocal** e **instrumental** (Demucs `htdemucs`);
3. obtém a **letra sincronizada palavra a palavra** — do [LRCLIB](https://lrclib.net) (alinhada ao vocal com WhisperX) ou, se não existir, transcrita pelo WhisperX/faster-whisper;
4. toca tudo num **player de karaokê** com tom, velocidade e volume do vocal guia ajustáveis.

Sem login, sem nuvem, sem deploy: tudo fica em `data/`.

## Funcionalidades

- **Biblioteca** com busca, capa, duração, idioma, origem da letra, progresso em tempo real (SSE), reprocessar e excluir.
- **Player**: letra com preenchimento palavra a palavra, contagem regressiva antes das linhas, layouts "linhas" e "rolagem", tela cheia limpa (controles somem quando ocioso), **tom (±12 semitons) sem mudar a velocidade**, **velocidade (0,5×–1,5×) sem mudar o tom**, volume do vocal guia (0–100 %) e do instrumental, ajuste fino de sincronia da letra (ms, salvo por música) e atalhos de teclado (`?` mostra todos).
- **Editor de letra**: linha do tempo com blocos de palavras arrastáveis, edição de texto/tempos por linha e por palavra, dividir/juntar/inserir/excluir linhas, **modo toque** (aperte Enter no instante em que cada palavra começa), desfazer, Ctrl+S, e "colar letra e alinhar" (forced alignment contra o vocal).
- **Worker independente**: `python -m worker.process <arquivo|URL> --out <pasta>`.

## Pré-requisitos

| Item | Versão | Observação |
|---|---|---|
| Node.js | 22.13+ (testado com 24) | a API usa o `node:sqlite` embutido |
| Python | 3.11 ou 3.12 | 3.13/3.14 ainda não são bem suportados pelas libs de IA; o `npm run setup` usa o [`uv`](https://docs.astral.sh/uv/) para baixar o 3.12 sozinho se preciso |
| GPU (opcional) | NVIDIA com CUDA, ou Apple Silicon (MPS) | sem GPU funciona em CPU, só que bem mais devagar (veja "Desempenho") |
| ffmpeg | — | **não precisa instalar**: o worker usa o binário do pacote `imageio-ffmpeg` (ou o do sistema, se houver) |
| Espaço em disco | ~10 GB | PyTorch (~3 GB) + modelos (~4–5 GB, baixados no 1º uso) + ~160 MB por música (WAVs) |
| Internet | — | para baixar do YouTube, modelos e consultar o LRCLIB |

Ambiente em que foi desenvolvido e testado: Windows 11, Node 24.20, Python 3.12.15 (venv), PyTorch 2.8.0+cu128, Demucs 4.1.0, WhisperX 3.8.6, faster-whisper 1.2.1, yt-dlp 2026.8.19, RTX 3060 12 GB.

## Instalação

```bash
npm install        # dependências do frontend e da API
npm run setup      # cria worker/.venv, instala PyTorch (CUDA/CPU/MPS), Demucs, WhisperX, yt-dlp... e cria o .env
npm run doctor     # (opcional) confere se está tudo certo
```

O `npm run setup` detecta GPU NVIDIA (`nvidia-smi`) e instala o PyTorch com CUDA 12.8; sem GPU instala a versão de CPU. Para fazer manualmente:

```bash
python -m venv worker/.venv            # ou: uv venv worker/.venv --python 3.12
worker/.venv/Scripts/python -m pip install torch==2.8.0 torchaudio==2.8.0 --index-url https://download.pytorch.org/whl/cu128   # CPU: .../whl/cpu
worker/.venv/Scripts/python -m pip install -r worker/requirements.txt
cp .env.example .env
```

(no Linux/macOS troque `Scripts` por `bin`).

## Como rodar

```bash
npm run dev
```

Sobe a API (porta 3001) e o frontend (http://localhost:5173) juntos. Abra http://localhost:5173, clique em **+ Adicionar música**, cole o link e aguarde o card ficar pronto.

Modo "produção" local (um único processo, a API serve o frontend buildado em http://localhost:3001):

```bash
npm run build
npm start
```

> O **primeiro** processamento baixa os modelos (Whisper large-v3 ~3 GB, wav2vec2 do idioma ~1,2 GB, htdemucs ~80 MB) e demora mais. Depois ficam em cache.

## Configuração (`.env`)

| Variável | Padrão | Para quê |
|---|---|---|
| `API_PORT` | `3001` | porta da API (não se chama `PORT` de propósito, para não colidir com ferramentas que definem `PORT`) |
| `DATA_DIR` | `./data` | onde ficam o banco SQLite e as músicas (`data/songs/<id>/`) |
| `WORKER_PYTHON` | `worker/.venv/Scripts/python.exe` | Python do venv do worker (Linux/macOS: `worker/.venv/bin/python`) |
| `KARAOKE_DEVICE` | `auto` | `auto` (CUDA → MPS → CPU), `cuda`, `mps` ou `cpu` |
| `WHISPER_MODEL` | `large-v3` na GPU, `small` na CPU | `tiny`, `base`, `small`, `medium`, `large-v3` |
| `WHISPER_COMPUTE_TYPE` | `auto` | `float16` (GPU), `int8` (CPU), `float32` |
| `LYRICS_LANGUAGE` | vazio | força o idioma (`pt`, `en`…); vazio = detecta automaticamente |
| `JOB_CONCURRENCY` | `1` | músicas processadas ao mesmo tempo (deixe 1 com uma só GPU) |

## Usando o worker sozinho (CLI)

```bash
worker/.venv/Scripts/python -m worker.process "https://www.youtube.com/watch?v=..." --out data/songs/teste
worker/.venv/Scripts/python -m worker.process minha-musica.mp3 --out data/songs/teste --title "Nome" --artist "Banda"
worker/.venv/Scripts/python -m worker.process --out data/songs/teste --only lyrics --lyrics-file letra.txt   # refaz só a letra
```

Saída em `--out`: `original.wav`, `vocals.wav`, `instrumental.wav`, `lyrics.json`, `meta.json` e `cover.jpg` (quando vem do YouTube). Cada etapa só roda se o arquivo ainda não existir (cache); `--force` refaz tudo. `--device cpu|cuda|mps` sobrescreve o `.env`. O progresso sai no stdout como JSON, uma linha por evento; logs vão para o stderr.

Formato de `lyrics.json`:

```json
{ "language": "pt", "source": "lrclib | whisperx | manual",
  "lines": [ { "start": 23.15, "end": 28.1, "text": "Estátuas e cofres…",
               "words": [ { "text": "Estátuas", "start": 23.15, "end": 24.48 } ] } ] }
```

## Como funciona (e decisões de projeto)

```
apps/web   React + Vite      biblioteca, player (AudioWorklet + SoundTouch), editor
apps/api   Fastify + SQLite  fila de jobs, SSE, arquivos com Range, letra
worker     Python            ingestão, Demucs, LRCLIB, WhisperX (CLI independente)
data/      songs/<id>/ e karaoke.db   (no .gitignore)
```

- **Fila em memória + SQLite** em vez de BullMQ/Redis: para uso pessoal Redis é peso morto. O estado durável é o SQLite; se a API cair no meio de um job, ele volta para a fila no próximo boot. A API roda o worker como processo filho e lê os eventos de progresso (JSON por linha no stdout).
- **`node:sqlite`** (embutido no Node 22.13+) em vez de `better-sqlite3`: sem compilação nativa no Windows.
- **Letra do LRCLIB é só por linha** — por isso ela é *alinhada ao vocal* com o aligner wav2vec2 do WhisperX, janela a janela, para ter tempo por palavra. Se o alinhamento de uma linha falhar, as palavras são distribuídas proporcionalmente ao tamanho. Quando o LRCLIB não acha nada, o WhisperX transcreve o vocal já separado (que rende bem mais que a mistura). Se o WhisperX falhar, cai no faster-whisper.
- **Título/artista**: o YouTube costuma vir como "Título - Artista" ou "Artista - Título"; quando o LRCLIB acha a música, o app corrige a ordem se estiver trocada. O que você digitar ao adicionar ou editar nunca é sobrescrito.
- **Pitch/velocidade independentes**: o player não usa `<audio>`. Os dois stems são decodificados e tocados por um `AudioWorklet` que roda o SoundTouch (um por stem, em lockstep) e só depois aplica os volumes — assim vocal guia e instrumental ficam sempre alinhados e o volume responde na hora. A posição de reprodução é integrada a partir dos frames de saída × velocidade; o teste `engine.test.ts` mede que o erro fica abaixo de ~40 ms em várias combinações de tom/velocidade.
- **Sincronia (offset)**: valor positivo **atrasa** a letra, negativo adianta; salvo por música no banco.
- Tom/velocidade/volumes ficam salvos por música no `localStorage` do navegador.

## Testes

```bash
npm test               # API (node:test) + frontend (vitest)
npm run test:worker    # worker (pytest; use o python do venv)
```

Cobrem: parsing de LRC e tempos por palavra, normalização da letra, endpoints da API (criação, cache por URL, busca, offset, letra, Range, exclusão), cálculo de linha atual/contagem regressiva/progresso de palavra, operações do editor e a calibração do motor de áudio.

## Desempenho (referência)

Música de ~5 min na RTX 3060 12 GB: separação ~1 min; letra do LRCLIB + alinhamento ~30 s; transcrição com Whisper large-v3 ~1–2 min. Em CPU conte com vários minutos por etapa; use `WHISPER_MODEL=small` (padrão em CPU) ou `base`.

## Solução de problemas

- **`npm run doctor` mostra "NÃO INSTALADO" / torch com `+cpu` numa máquina com NVIDIA**: reinstale o torch pelo índice CUDA (comando manual acima) ou rode `npm run setup` de novo.
- **`CUDA out of memory`**: defina `WHISPER_MODEL=medium` (ou `small`) e/ou `WHISPER_COMPUTE_TYPE=int8` no `.env`; feche programas que usam a GPU.
- **"Não consegui iniciar o worker"**: o `WORKER_PYTHON` do `.env` não aponta para o venv. No Linux/macOS use `worker/.venv/bin/python`.
- **yt-dlp falha / vídeo indisponível / HTTP 403**: o YouTube muda com frequência; atualize: `worker/.venv/Scripts/python -m pip install -U yt-dlp`. Vídeos com restrição de idade/região podem exigir cookies (não suportado aqui) — baixe o áudio por outro meio e use "Arquivo de áudio".
- **Letra errada ou sem letra**: no menu `⋯` do card use **Refazer letra…** e cole a letra correta (texto puro ou LRC), ou corrija no **Editor de letra**.
- **Letra levemente adiantada/atrasada no player**: use os botões de sincronia (`,` e `.` = ±50 ms); o ajuste fica salvo para a música.
- **Sem som / player "Carregando áudio…" para sempre**: confira se `data/songs/<id>/vocals.wav` e `instrumental.wav` existem e se o navegador permite áudio no site (clique em Play: o navegador só libera o áudio após um gesto).
- **Porta em uso**: mude `API_PORT` no `.env` (o Vite lê o mesmo arquivo para o proxy).
- **Primeiro processamento "travado" em 70 %**: está baixando o modelo de alinhamento (~1,2 GB); veja o terminal.
- **Windows: erro de caminho com acentos/OneDrive**: funciona, mas se algo estranho acontecer mova o projeto para um caminho curto (ex.: `C:\dev\karaoke`).
- **O processamento ficou preso depois de reiniciar o PC**: ao subir, a API retoma automaticamente jobs interrompidos; se um deles falhar, use "Tentar de novo" no card.

## Aviso

Use apenas com conteúdo que você tem direito de usar. O projeto é pessoal/local e não distribui nada.
