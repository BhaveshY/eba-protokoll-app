import type {
  DeepgramResponse,
  TranscribeArgs,
} from "../shared/deepgram";
import { transcribe } from "../shared/deepgram";
import type { TranscribeAudioRequest } from "../shared/ipc";

export class MainTranscriptionBusy extends Error {
  constructor() {
    super("Transkription laeuft bereits.");
  }
}

export interface MainTranscriptionDeps {
  readApiKey: () => Promise<string>;
  transcribeImpl?: (args: TranscribeArgs) => Promise<DeepgramResponse>;
}

export class MainTranscriptionController {
  private active: AbortController | null = null;
  private readonly transcribeImpl: (args: TranscribeArgs) => Promise<DeepgramResponse>;

  constructor(private readonly deps: MainTranscriptionDeps) {
    this.transcribeImpl = deps.transcribeImpl ?? transcribe;
  }

  async transcribe(request: TranscribeAudioRequest): Promise<DeepgramResponse> {
    if (this.active) throw new MainTranscriptionBusy();

    const controller = new AbortController();
    this.active = controller;
    try {
      const apiKey = await this.deps.readApiKey();
      return await this.transcribeImpl({
        blob: new Blob([request.audioBytes]),
        filename: request.filename,
        apiKey,
        endpoint: request.config.deepgramEndpoint,
        options: {
          language: request.config.language,
          multichannel: request.isRecordedStereo,
          keyterms: request.keyterms,
          smartFormat: request.config.smartFormat,
          filterFillers: request.config.filterFillers,
          paragraphs: request.config.paragraphs,
          summarize: request.config.summarize,
        },
        signal: controller.signal,
      });
    } finally {
      if (this.active === controller) this.active = null;
    }
  }

  cancel(): void {
    this.active?.abort();
  }
}
