import { encodeWavFromChunks, totalSamples } from "./wav";

/**
 * Recorder captures mic + (optional) system audio as separate tracks,
 * then produces a stereo PCM WAV blob with mic on the left channel and
 * system audio on the right channel.
 *
 * System audio source per platform:
 *  - Windows: Electron desktopCapturer screen source with
 *    chromeMediaSource=desktop + chromeMediaSourceAudio=loopback.
 *    We implement that via a renderer-side shortcut: ask for a stream from
 *    the installed loopback deviceId if present; on Windows 11 + Stereo Mix
 *    or similar virtual devices this works via MediaDevices too.
 *  - macOS / Linux: user-chosen virtual input device (BlackHole, PulseAudio monitor).
 */

export interface RecorderOptions {
  micDeviceId?: string;
  systemDeviceId?: string;
  sampleRate?: number;
  onLevel?: (levels: RecorderLevels) => void;
}

export interface RecordingResult {
  stereo: Blob;
  durationSec: number;
  usedSystemAudio: boolean;
  extension: string;
}

export interface RecorderLevels {
  mic: number;
  system: number;
  usedSystemAudio: boolean;
}

const DEFAULT_SR = 16000;

export class MeetingRecorder {
  private micStream: MediaStream | null = null;
  private sysStream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private micProcessor: ScriptProcessorNode | null = null;
  private sysProcessor: ScriptProcessorNode | null = null;
  private micChunks: Float32Array[] = [];
  private sysChunks: Float32Array[] = [];
  private graphNodes: AudioNode[] = [];
  private levels: RecorderLevels = {
    mic: 0,
    system: 0,
    usedSystemAudio: false,
  };
  private startedAt = 0;

  constructor(private opts: RecorderOptions = {}) {}

  get running(): boolean {
    return this.ctx !== null;
  }

  async start(): Promise<void> {
    if (this.running) throw new Error("Recorder laeuft bereits.");
    const sr = this.opts.sampleRate ?? DEFAULT_SR;
    this.ctx = new AudioContext({ sampleRate: sr });

    // Mic stream
    const micConstraints: MediaTrackConstraints = this.opts.micDeviceId
      ? {
          deviceId: { exact: this.opts.micDeviceId },
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        }
      : { echoCancellation: true, noiseSuppression: true, channelCount: 1 };
    this.micStream = await navigator.mediaDevices.getUserMedia({
      audio: micConstraints,
    });
    this.attachProcessor(this.micStream, "mic");

    // System-audio stream (optional)
    if (this.opts.systemDeviceId) {
      try {
        this.sysStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: this.opts.systemDeviceId },
            echoCancellation: false,
            noiseSuppression: false,
            channelCount: 1,
          },
        });
        this.attachProcessor(this.sysStream, "sys");
      } catch (err) {
        console.warn("System-audio stream failed:", err);
        this.sysStream = null;
      }
    }

    this.startedAt = performance.now();
  }

  private attachProcessor(stream: MediaStream, kind: "mic" | "sys"): void {
    if (!this.ctx) return;
    const source = this.ctx.createMediaStreamSource(stream);
    // ScriptProcessorNode keeps explicit PCM channel control, which is
    // important for Deepgram multichannel diarization.
    const proc = this.ctx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = (evt) => {
      const input = evt.inputBuffer.getChannelData(0);
      const copy = new Float32Array(input.length);
      copy.set(input);
      if (kind === "mic") this.micChunks.push(copy);
      else this.sysChunks.push(copy);
      this.reportLevel(kind, input);
    };

    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    source.connect(proc);
    proc.connect(mute);
    mute.connect(this.ctx.destination);

    this.graphNodes.push(source, proc, mute);
    if (kind === "mic") this.micProcessor = proc;
    else this.sysProcessor = proc;
  }

  private reportLevel(kind: "mic" | "sys", input: Float32Array): void {
    const level = audioLevel(input);
    this.levels = {
      mic: kind === "mic" ? level : this.levels.mic,
      system: kind === "sys" ? level : this.levels.system,
      usedSystemAudio: this.sysStream !== null,
    };
    this.opts.onLevel?.(this.levels);
  }

  async stop(): Promise<RecordingResult> {
    if (!this.ctx) throw new Error("Recorder laeuft nicht.");

    const durationSec = (performance.now() - this.startedAt) / 1000;
    const sr = this.ctx.sampleRate;
    const usedSystemAudio = this.sysStream !== null;
    const frameCount = Math.max(
      totalSamples(this.micChunks),
      totalSamples(this.sysChunks)
    );

    this.micStream?.getTracks().forEach((t) => t.stop());
    this.sysStream?.getTracks().forEach((t) => t.stop());
    this.disconnectGraph();

    if (frameCount === 0) {
      await this.cleanup();
      throw new Error("Aufnahme ist leer.");
    }

    const channels = usedSystemAudio
      ? [this.micChunks, this.sysChunks]
      : [this.micChunks];
    const stereo = encodeWavFromChunks(channels, sr);
    await this.cleanup();

    return {
      stereo,
      durationSec,
      usedSystemAudio,
      extension: "wav",
    };
  }

  abort(): void {
    void this.cleanup();
  }

  private async cleanup(): Promise<void> {
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.sysStream?.getTracks().forEach((t) => t.stop());
    this.disconnectGraph();
    await this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.micStream = null;
    this.sysStream = null;
    this.micProcessor = null;
    this.sysProcessor = null;
    this.micChunks = [];
    this.sysChunks = [];
    this.levels = { mic: 0, system: 0, usedSystemAudio: false };
  }

  private disconnectGraph(): void {
    this.micProcessor?.disconnect();
    this.sysProcessor?.disconnect();
    for (const node of this.graphNodes) node.disconnect();
    this.graphNodes = [];
  }
}

function audioLevel(input: Float32Array): number {
  let sumSquares = 0;
  for (let i = 0; i < input.length; i++) {
    const sample = input[i];
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, input.length));
  return Math.max(0, Math.min(1, rms * 6));
}
