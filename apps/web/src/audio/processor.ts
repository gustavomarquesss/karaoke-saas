/* AudioWorkletProcessor do karaokê: roda o KaraokeEngine na thread de áudio. */
import { KaraokeEngine } from './engine';

declare const sampleRate: number;
declare const currentTime: number;
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

type Params = Parameters<KaraokeEngine['setParams']>[0];

type InMessage =
  | { type: 'load'; vocals: { l: Float32Array; r: Float32Array }; instrumental: { l: Float32Array; r: Float32Array } }
  | ({ type: 'params' } & Params)
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; frame: number };

class KaraokeProcessor extends AudioWorkletProcessor {
  private engine: KaraokeEngine | null = null;
  private pending: Params = {};
  private blocks = 0;
  private wasPlaying = false;
  private announce = false;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<InMessage>) => this.onMessage(e.data);
  }

  private onMessage(msg: InMessage): void {
    switch (msg.type) {
      case 'load':
        this.engine = new KaraokeEngine(msg.vocals, msg.instrumental, sampleRate);
        this.engine.setParams(this.pending);
        this.port.postMessage({ type: 'ready', frames: this.engine.totalFrames });
        break;
      case 'params': {
        const { type: _type, ...rest } = msg;
        this.pending = { ...this.pending, ...rest };
        this.engine?.setParams(this.pending);
        break;
      }
      case 'play':
        if (this.engine) this.engine.playing = true;
        this.announce = true;
        break;
      case 'pause':
        if (this.engine) this.engine.playing = false;
        break;
      case 'seek':
        this.engine?.seek(msg.frame);
        break;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const engine = this.engine;
    if (!engine || out.length === 0) return true;
    const n = out[0].length;
    if (engine.playing && this.announce) {
      // marca o frame do AudioContext em que esta posição da música começa a sair (alinha a gravação)
      this.announce = false;
      this.port.postMessage({ type: 'started', frame: currentFrame, media: engine.positionFrames });
    }
    engine.render(out[0], out[1] ?? out[0], n);
    this.blocks++;
    const playing = engine.playing;
    // a cada 12 blocos de 128 frames (~35 ms) ou quando o estado muda
    if (this.blocks % 12 === 0 || playing !== this.wasPlaying) {
      this.port.postMessage({ type: 'pos', frame: engine.positionFrames, at: currentTime, cf: currentFrame, playing });
    }
    if (engine.ended && this.wasPlaying) this.port.postMessage({ type: 'ended' });
    this.wasPlaying = playing;
    return true;
  }
}

registerProcessor('karaoke-processor', KaraokeProcessor);
