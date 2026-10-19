declare module 'soundtouchjs' {
  export class FifoBuffer {
    readonly frameCount: number;
  }
  export class SoundTouch {
    tempo: number;
    rate: number;
    pitch: number;
    pitchSemitones: number;
    readonly inputBuffer: FifoBuffer;
    readonly outputBuffer: FifoBuffer;
  }
  export interface SampleSource {
    extract(target: Float32Array, numFrames: number, position: number): number;
  }
  export class SimpleFilter {
    constructor(source: SampleSource, pipe: SoundTouch, callback?: () => void);
    sourcePosition: number;
    readonly position: number;
    readonly outputBuffer: FifoBuffer;
    readonly outputBufferPosition: number;
    extract(target: Float32Array, numFrames: number): number;
    clear(): void;
  }
}
