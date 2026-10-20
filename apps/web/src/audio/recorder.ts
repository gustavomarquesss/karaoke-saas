import type { VoiceFx } from '../lib/voicefx';
import recorderUrl from './recorder-processor.ts?worker&url';
import { createVoiceChain, type VoiceChain } from './voicefx';

/**
 * Captura o microfone cru (sem cancelamento de eco/AGC) num AudioWorklet e entrega blocos
 * carimbados com o frame do AudioContext. Opcionalmente deixa você se ouvir com o efeito (fones!).
 */
export class VoiceRecorder {
  /** latência de entrada informada pelo navegador (s); 0 se desconhecida */
  readonly inputLatency: number;
  private gate: GainNode;
  private chain: VoiceChain | null = null;
  private monitorGain: GainNode | null = null;
  private stopped = false;

  private constructor(
    private ctx: AudioContext,
    private stream: MediaStream,
    private src: MediaStreamAudioSourceNode,
    private node: AudioWorkletNode,
    inputLatency: number,
    onChunk: (frame: number, data: Float32Array) => void,
  ) {
    this.inputLatency = inputLatency;
    this.gate = ctx.createGain();
    this.gate.gain.value = 0; // o worklet precisa de saída conectada para rodar; silenciosa
    src.connect(node);
    node.connect(this.gate).connect(ctx.destination);
    node.port.onmessage = (e: MessageEvent<{ frame: number; data: Float32Array }>) => {
      if (!this.stopped) onChunk(e.data.frame, e.data.data);
    };
  }

  static async create(ctx: AudioContext, onChunk: (frame: number, data: Float32Array) => void): Promise<VoiceRecorder> {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador não permite acessar o microfone (é preciso HTTPS ou localhost).');
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
      });
    } catch (e) {
      const name = (e as DOMException).name;
      throw new Error(name === 'NotAllowedError' ? 'Permissão do microfone negada. Libere o acesso no navegador e tente de novo.' : name === 'NotFoundError' ? 'Nenhum microfone encontrado.' : `Não consegui abrir o microfone (${(e as Error).message}).`);
    }
    await ctx.audioWorklet.addModule(recorderUrl);
    const src = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'recorder-processor', { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1 });
    const latency = Number((stream.getAudioTracks()[0]?.getSettings() as MediaTrackSettings & { latency?: number }).latency ?? 0);
    return new VoiceRecorder(ctx, stream, src, node, latency, onChunk);
  }

  /** Liga/desliga a escuta da própria voz com o efeito. Use fones: nas caixas dá microfonia. */
  setMonitor(on: boolean, fx: VoiceFx): void {
    if (this.stopped) return;
    if (on && !this.chain) {
      this.chain = createVoiceChain(this.ctx, fx, true);
      this.monitorGain = this.ctx.createGain();
      this.monitorGain.gain.value = 1;
      this.src.connect(this.chain.input);
      this.chain.output.connect(this.monitorGain).connect(this.ctx.destination);
    } else if (!on && this.chain) {
      this.src.disconnect(this.chain.input);
      this.chain.dispose();
      this.monitorGain?.disconnect();
      this.chain = null;
      this.monitorGain = null;
    } else if (on && this.chain) {
      this.chain.apply(fx);
    }
  }

  stop(): void {
    if (this.stopped) return;
    this.setMonitor(false, { cleanup: false, compress: 0, brightness: 0, reverb: 0, echo: 0 });
    this.stopped = true;
    this.src.disconnect();
    this.node.disconnect();
    this.gate.disconnect();
    this.stream.getTracks().forEach((t) => t.stop());
  }
}
