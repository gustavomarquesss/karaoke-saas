/* Captura o microfone no AudioWorklet, marcando cada bloco com o frame do AudioContext
   (`currentFrame`), o que permite alinhar a voz com a música com precisão de amostra. */
declare const currentFrame: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, ctor: new () => AudioWorkletProcessor): void;

const BLOCKS_PER_MESSAGE = 16; // 16 × 128 frames ≈ 46 ms

class RecorderProcessor extends AudioWorkletProcessor {
  private buf = new Float32Array(128 * BLOCKS_PER_MESSAGE);
  private filled = 0;
  private startFrame = 0;

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    if (this.filled === 0) this.startFrame = currentFrame;
    this.buf.set(ch, this.filled);
    this.filled += ch.length;
    if (this.filled >= this.buf.length) {
      const data = this.buf.slice(0, this.filled);
      this.port.postMessage({ frame: this.startFrame, data }, [data.buffer]);
      this.filled = 0;
    }
    return true;
  }
}

registerProcessor('recorder-processor', RecorderProcessor);
