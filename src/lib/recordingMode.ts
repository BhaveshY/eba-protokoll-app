import {
  resolveSystemAudioPlan,
  type AudioInputDevice,
  type SystemAudioPlan,
} from "./devices";

export type RecordingIntent = "meeting" | "minutes";

export type RecordingAudioPlan =
  | { intent: "minutes"; status: "minutes_only" }
  | ({ intent: "meeting" } & SystemAudioPlan);

export function shouldListInputDevices(
  intent: RecordingIntent,
  configuredSystemAudio: string
): boolean {
  return intent === "meeting" && configuredSystemAudio.trim().length > 0;
}

export function shouldConfirmRecordingIntent(intent: RecordingIntent): boolean {
  return intent === "meeting";
}

export function resolveRecordingAudioPlan(
  intent: RecordingIntent,
  platform: NodeJS.Platform,
  devices: AudioInputDevice[],
  configuredSystemAudio: string
): RecordingAudioPlan {
  if (intent === "minutes") {
    return { intent: "minutes", status: "minutes_only" };
  }

  return {
    intent: "meeting",
    ...resolveSystemAudioPlan(platform, devices, configuredSystemAudio),
  };
}
