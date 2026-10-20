import { dspParams, isDry, type VoiceFx } from '../lib/voicefx';
import type { Stem } from './engine';

/**
 * Cadeia de efeitos de voz em Web Audio. A MESMA cadeia roda ao vivo (para você se ouvir cantando)
 * e offline (para aplicar na mix durante a edição), então o som é idêntico nos dois casos.
 *
 *   entrada → passa-altas → compressor → ganho → presença → brilho ─┬─ seco ──────────────┐
 *                                                                    ├─ reverb (convolução)─┼→ saída
 *                                                                    └─ eco (delay+feedback)┘
 */
export interface VoiceChain {
  input: AudioNode;
  output: AudioNode;
  apply(fx: VoiceFx): void;
  dispose(): void;
}

/** Resposta ao impulso sintética: ruído com decaimento exponencial e abafamento progressivo. */
function makeImpulse(ctx: BaseAudioContext, seconds = 2.4, decay = 2.8): AudioBuffer {
  const n = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, n, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let y = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const a = 0.55 * (1 - t) + 0.08; // abafa mais conforme o tempo passa (reverb natural)
      y += a * ((Math.random() * 2 - 1) - y);
      d[i] = y * Math.pow(1 - t, decay) * 1.6;
    }
  }
  return buf;
}

export function createVoiceChain(ctx: BaseAudioContext, fx: VoiceFx, live: boolean): VoiceChain {
  const input = ctx.createGain();
  const hpf = ctx.createBiquadFilter();
  hpf.type = 'highpass';
  hpf.Q.value = 0.7;
  const comp = ctx.createDynamicsCompressor();
  comp.knee.value = 18;
  comp.attack.value = 0.006;
  comp.release.value = 0.18;
  const makeup = ctx.createGain();
  const presence = ctx.createBiquadFilter();
  presence.type = 'peaking';
  presence.frequency.value = 3200;
  presence.Q.value = 0.9;
  const shelf = ctx.createBiquadFilter();
  shelf.type = 'highshelf';
  shelf.frequency.value = 7000;
  const post = ctx.createGain();

  const out = ctx.createGain();
  const dry = ctx.createGain();

  const convolver = ctx.createConvolver();
  convolver.buffer = makeImpulse(ctx);
  const reverbWet = ctx.createGain();

  const delay = ctx.createDelay(1);
  const feedback = ctx.createGain();
  const echoTone = ctx.createBiquadFilter();
  echoTone.type = 'lowpass';
  echoTone.frequency.value = 3200;
  const echoWet = ctx.createGain();

  input.connect(hpf).connect(comp).connect(makeup).connect(presence).connect(shelf).connect(post);
  post.connect(dry).connect(out);
  post.connect(convolver).connect(reverbWet).connect(out);
  post.connect(delay).connect(echoWet).connect(out);
  delay.connect(echoTone).connect(feedback).connect(delay);

  const set = (p: AudioParam, v: number) => (live ? p.setTargetAtTime(v, ctx.currentTime, 0.015) : void (p.value = v));

  const apply = (next: VoiceFx) => {
    const d = dspParams(next);
    set(hpf.frequency, d.hpfHz);
    set(comp.threshold, d.compThresholdDb);
    set(comp.ratio, d.compRatio);
    set(makeup.gain, d.makeupGain);
    set(presence.gain, d.presenceDb);
    set(shelf.gain, d.highShelfDb);
    set(reverbWet.gain, d.reverbWet);
    set(echoWet.gain, d.echoWet);
    set(delay.delayTime, d.echoSeconds);
    set(feedback.gain, d.echoFeedback);
  };
  apply(fx);

  return {
    input,
    output: out,
    apply,
    dispose() {
      for (const n of [input, hpf, comp, makeup, presence, shelf, post, out, dry, convolver, reverbWet, delay, feedback, echoTone, echoWet]) n.disconnect();
    },
  };
}

/** Aplica os efeitos numa faixa de voz (mono) inteira e devolve estéreo do mesmo tamanho. */
export async function renderVoiceFx(mic: Float32Array, sampleRate: number, fx: VoiceFx): Promise<Stem> {
  if (isDry(fx) || mic.length === 0) return { l: mic, r: mic };
  const ctx = new OfflineAudioContext(2, mic.length, sampleRate);
  const buf = ctx.createBuffer(1, mic.length, sampleRate);
  buf.copyToChannel(mic as Float32Array<ArrayBuffer>, 0);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const chain = createVoiceChain(ctx, fx, false);
  src.connect(chain.input);
  chain.output.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  return { l: rendered.getChannelData(0), r: rendered.getChannelData(1) };
}

const FX_TAIL_SECONDS = 2.8;

/**
 * Aplica os efeitos só onde há voz (as janelas gravadas + a "cauda" do reverb/eco), em vez da música
 * inteira — a mix refaz em segundos mesmo para músicas longas.
 */
export async function renderVoiceFxRegions(dry: Float32Array, windows: [number, number][], sampleRate: number, fx: VoiceFx): Promise<Stem> {
  if (isDry(fx)) return { l: dry, r: dry };
  const n = dry.length;
  const tail = Math.round(FX_TAIL_SECONDS * sampleRate);
  const regions: [number, number][] = [];
  for (const [a, b] of [...windows].sort((x, y) => x[0] - y[0])) {
    const start = Math.max(0, a);
    const end = Math.min(n, b + tail);
    if (end <= start) continue;
    const last = regions[regions.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else regions.push([start, end]);
  }
  const out = { l: new Float32Array(n), r: new Float32Array(n) };
  for (const [a, b] of regions) {
    const wet = await renderVoiceFx(dry.slice(a, b), sampleRate, fx);
    out.l.set(wet.l, a);
    out.r.set(wet.r, a);
  }
  return out;
}
