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
