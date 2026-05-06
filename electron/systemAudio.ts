import type { Session } from "electron";

export interface DesktopSource {
  id: string;
  name: string;
}

export interface DesktopSourceProvider {
  getSources(options: {
    types: Array<"screen" | "window">;
    thumbnailSize: { width: number; height: number };
  }): Promise<DesktopSource[]>;
}

export interface DisplayMediaSession {
  setDisplayMediaRequestHandler: Session["setDisplayMediaRequestHandler"];
}

export interface WindowsLoopbackStreams {
  video: { id: string; name: string };
  audio: "loopback";
}

export async function windowsLoopbackStreams(
  provider: DesktopSourceProvider
): Promise<WindowsLoopbackStreams> {
  const sources = await provider.getSources({
    types: ["screen"],
    thumbnailSize: { width: 0, height: 0 },
  });
  const [source] = sources;
  if (!source) throw new Error("No screen source available for loopback audio.");
  return {
    video: { id: source.id, name: source.name },
    audio: "loopback",
  };
}

export function installWindowsLoopbackDisplayMediaHandler(
  platform: NodeJS.Platform,
  ses: DisplayMediaSession,
  provider: DesktopSourceProvider
): boolean {
  if (platform !== "win32") return false;
  ses.setDisplayMediaRequestHandler((_request, callback) => {
    void windowsLoopbackStreams(provider)
      .then((streams) => callback(streams as Electron.Streams))
      .catch(() => callback({}));
  });
  return true;
}
