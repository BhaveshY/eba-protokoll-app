import { describe, expect, it } from "vitest";
import type { AppConfig, TranscribeAudioRequest } from "../shared/ipc";
import type { TranscribeArgs } from "../shared/deepgram";
import {
  MainTranscriptionController,
  MainTranscriptionBusy,
} from "../electron/transcription";

const config: AppConfig = {
  language: "multi",
  uiLanguage: "de",
  outputDir: "/tmp/out",
  keytermProfile: "default",
  deepgramEndpoint: "https://api.eu.deepgram.com",
  systemAudioDevice: "",
  smartFormat: true,
  filterFillers: false,
  paragraphs: true,
  summarize: false,
  generateSubtitles: true,
};

function request(
  patch: Partial<TranscribeAudioRequest> = {}
): TranscribeAudioRequest {
  return {
    audioBytes: new Uint8Array([1, 2, 3]).buffer,
    filename: "meeting.wav",
    config,
    isRecordedStereo: true,
    keyterms: ["EB&A", "Baugesuch"],
    ...patch,
  };
}

describe("MainTranscriptionController", () => {
  it("reads the API key in main and forwards quality-critical Deepgram options", async () => {
    let received: TranscribeArgs | undefined;
    const controller = new MainTranscriptionController({
      readApiKey: async () => "dg_main_key",
      transcribeImpl: async (args) => {
        received = args;
        return { results: { utterances: [] } };
      },
    });

    await controller.transcribe(request());

    expect(received).toBeDefined();
    const args = received as TranscribeArgs;
    expect(args.apiKey).toBe("dg_main_key");
    expect(args.filename).toBe("meeting.wav");
    expect(args.endpoint).toBe(config.deepgramEndpoint);
    expect(args.options).toMatchObject({
      language: "multi",
      multichannel: true,
      keyterms: ["EB&A", "Baugesuch"],
      smartFormat: true,
      filterFillers: false,
      paragraphs: true,
      summarize: false,
    });
    expect(args.blob.size).toBe(3);
  });

  it("rejects concurrent main-process transcription jobs", async () => {
    const gate = deferred<void>();
    const controller = new MainTranscriptionController({
      readApiKey: async () => "dg_main_key",
      transcribeImpl: async () => {
        await gate.promise;
        return { results: { utterances: [] } };
      },
    });

    const first = controller.transcribe(request());
    await expect(controller.transcribe(request())).rejects.toBeInstanceOf(
      MainTranscriptionBusy
    );

    gate.resolve();
    await first;
  });

  it("aborts the active Deepgram request when cancelled", async () => {
    let sawAbort = false;
    const controller = new MainTranscriptionController({
      readApiKey: async () => "dg_main_key",
      transcribeImpl: async (args) => {
        if (args.signal?.aborted) {
          sawAbort = true;
          return { results: { utterances: [] } };
        }
        await new Promise<void>((resolve) => {
          args.signal?.addEventListener("abort", () => resolve(), {
            once: true,
          });
        });
        sawAbort = args.signal?.aborted === true;
        return { results: { utterances: [] } };
      },
    });

    const active = controller.transcribe(request());
    controller.cancel();
    await expect(active).resolves.toEqual({ results: { utterances: [] } });
    expect(sawAbort).toBe(true);
  });
});

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
