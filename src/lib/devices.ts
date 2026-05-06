export interface AudioInputDevice {
  deviceId: string;
  label: string;
  groupId: string;
}

const LOOPBACK_HINTS = [
  "blackhole",
  "soundflower",
  "loopback",
  "monitor of",
  "aggregate",
  "stereo mix",
  "wave out",
];

export async function listInputDevices(): Promise<AudioInputDevice[]> {
  // Calling getUserMedia once first makes labels become visible.
  let granted = false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    granted = true;
  } catch {
    granted = false;
  }
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter((d) => d.kind === "audioinput")
    .map((d) => ({
      deviceId: d.deviceId,
      label: d.label || (granted ? `Eingabegeraet (${d.deviceId.slice(0, 6)})` : "Unbenanntes Geraet"),
      groupId: d.groupId,
    }));
}

export function isLikelyLoopbackDevice(
  device: Pick<AudioInputDevice, "label">
): boolean {
  const label = device.label.toLowerCase();
  return LOOPBACK_HINTS.some((hint) => label.includes(hint));
}

export function filterLoopbackDevices(
  devices: AudioInputDevice[]
): AudioInputDevice[] {
  return devices.filter((device) => isLikelyLoopbackDevice(device));
}

export async function listLoopbackDevices(): Promise<AudioInputDevice[]> {
  return filterLoopbackDevices(await listInputDevices());
}

export function findDeviceByHint(
  devices: AudioInputDevice[],
  hint: string
): AudioInputDevice | undefined {
  if (!hint) return undefined;
  const needle = hint.toLowerCase();
  return devices.find((d) => d.label.toLowerCase().includes(needle));
}

export type SystemAudioResolution =
  | { status: "disabled"; hint: "" }
  | { status: "configured_missing"; hint: string }
  | { status: "found"; hint: string; deviceId: string; label: string };

export type SystemAudioSource =
  | { kind: "windows-loopback"; fallbackDeviceId?: string }
  | { kind: "input-device"; deviceId: string };

export type SystemAudioPlan =
  | { status: "disabled"; hint: ""; source?: never }
  | { status: "configured_missing"; hint: string; source?: never }
  | {
      status: "found";
      hint: string;
      deviceId: string;
      label: string;
      source: { kind: "input-device"; deviceId: string };
    }
  | {
      status: "windows_loopback";
      source: { kind: "windows-loopback"; fallbackDeviceId?: string };
      fallback?: { deviceId: string; label: string };
    };

export function resolveSystemAudioDevice(
  devices: AudioInputDevice[],
  hint: string
): SystemAudioResolution {
  const cleanHint = hint.trim();
  if (!cleanHint) return { status: "disabled", hint: "" };
  const device = findDeviceByHint(devices, cleanHint);
  if (!device) {
    return { status: "configured_missing", hint: cleanHint };
  }
  return {
    status: "found",
    hint: cleanHint,
    deviceId: device.deviceId,
    label: device.label,
  };
}

export function resolveSystemAudioPlan(
  platform: NodeJS.Platform,
  devices: AudioInputDevice[],
  hint: string
): SystemAudioPlan {
  if (platform === "win32") {
    const fallback = findDeviceByHint(devices, hint.trim());
    if (!fallback) {
      return { status: "windows_loopback", source: { kind: "windows-loopback" } };
    }
    return {
      status: "windows_loopback",
      fallback: {
        deviceId: fallback.deviceId,
        label: fallback.label,
      },
      source: {
        kind: "windows-loopback",
        fallbackDeviceId: fallback.deviceId,
      },
    };
  }

  const resolution = resolveSystemAudioDevice(devices, hint);
  if (resolution.status !== "found") return resolution;
  return {
    ...resolution,
    source: { kind: "input-device", deviceId: resolution.deviceId },
  };
}
