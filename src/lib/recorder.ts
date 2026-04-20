import { encodeWav } from "./wav";

/**
 * Recorder captures mic + (optional) system audio as separate tracks,
 * then produces a stereo WAV blob with mic on the left and system on the right.
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
}

export interface RecordingResult {
  stereo: Blob;        // audio/wav
  durationSec: number;
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
    // ScriptProcessorNode is deprecated but the simplest path for reliable
    // PCM capture; AudioWorklets work too but require a second file.
    const proc = this.ctx.createScriptProcessor(4096, 1, 1);
    proc.onaudioprocess = (evt) => {
      const input = evt.inputBuffer.getChannelData(0);
      // Copy — inputBuffer data is reused across callbacks.
      const copy = new Float32Array(input.length);
      copy.set(input);
      if (kind === "mic") this.micChunks.push(copy);
      else this.sysChunks.push(copy);
    };
    source.connect(proc);
    // Must connect to destination for the processor to fire in some browsers.
    // Route to a zero-gain node to avoid monitoring the audio.
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    proc.connect(mute);
    mute.connect(this.ctx.destination);

    if (kind === "mic") this.micProcessor = proc;
    else this.sysProcessor = proc;
  }

  async stop(): Promise<RecordingResult> {
    if (!this.ctx) throw new Error("Recorder laeuft nicht.");

    const durationSec = (performance.now() - this.startedAt) / 1000;
    const sr = this.ctx.sampleRate;

    this.micStream?.getTracks().forEach((t) => t.stop());
    this.sysStream?.getTracks().forEach((t) => t.stop());
    this.micProcessor?.disconnect();
    this.sysProcessor?.disconnect();

    const micFlat = flatten(this.micChunks);
    const sysFlat = flatten(this.sysChunks);
    const usedSystemAudio = sysFlat.length > 0;
    const n = Math.max(micFlat.length, sysFlat.length);

    const audioBuf = this.ctx.createBuffer(
      usedSystemAudio ? 2 : 1,
      n,
      sr
    );
    audioBuf.getChannelData(0).set(padTo(micFlat, n));
    if (usedSystemAudio) audioBuf.getChannelData(1).set(padTo(sysFlat, n));

    const stereo = encodeWav(audioBuf);

    await this.ctx.close();
    this.ctx = null;
    this.micStream = null;
    this.sysStream = null;
    this.micChunks = [];
    this.sysChunks = [];

    return { stereo, durationSec, usedSystemAudio };
  }

  abort(): void {
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.sysStream?.getTracks().forEach((t) => t.stop());
    this.micProcessor?.disconnect();
    this.sysProcessor?.disconnect();
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.micStream = null;
    this.sysStream = null;
    this.micChunks = [];
    this.sysChunks = [];
  }
}

function flatten(chunks: Float32Array[]): Float32Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}

function padTo(arr: Float32Array, n: number): Float32Array {
  if (arr.length >= n) return arr.subarray(0, n);
  const out = new Float32Array(n);
  out.set(arr);
  return out;
}
