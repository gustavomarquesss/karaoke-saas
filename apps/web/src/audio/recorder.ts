import recorderUrl from './recorder-processor.ts?worker&url';

export interface MicTake {
  /** voz (mono) a partir de `firstFrame` */
  mic: Float32Array;
  /** frame do AudioContext em que a primeira amostra de `mic` foi capturada */
  firstFrame: number;
  /** latência de entrada informada pelo navegador (s), 0 se desconhecida */
  inputLatency: number;
}

/** Grava o microfone cru (sem cancelamento de eco/AGC) em um AudioWorklet. */
export class VoiceRecorder {
  private chunks: Float32Array[] = [];
  private firstFrame: number | null = null;
  private gate: GainNode;

  private constructor(
    ctx: AudioContext,
    private stream: MediaStream,
    private src: MediaStreamAudioSourceNode,
    private node: AudioWorkletNode,
    private inputLatency: number,
  ) {
    this.gate = ctx.createGain();
    this.gate.gain.value = 0; // o worklet precisa de saída conectada para rodar; silenciosa
    src.connect(node);
    node.connect(this.gate).connect(ctx.destination);
    node.port.onmessage = (e: MessageEvent<{ frame: number; data: Float32Array }>) => {
      if (this.firstFrame === null) this.firstFrame = e.data.frame;
      this.chunks.push(e.data.data);
    };
  }

  static async create(ctx: AudioContext): Promise<VoiceRecorder> {
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
    return new VoiceRecorder(ctx, stream, src, node, latency);
  }

  /** Para a captura e devolve tudo que foi gravado. */
  stop(): MicTake {
    this.dispose();
    const total = this.chunks.reduce((n, c) => n + c.length, 0);
    const mic = new Float32Array(total);
    let o = 0;
    for (const c of this.chunks) {
      mic.set(c, o);
      o += c.length;
    }
    return { mic, firstFrame: this.firstFrame ?? 0, inputLatency: this.inputLatency };
  }

  dispose(): void {
    this.src.disconnect();
    this.node.disconnect();
    this.gate.disconnect();
    this.stream.getTracks().forEach((t) => t.stop());
  }
}
