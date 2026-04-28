import { contextBridge, ipcRenderer } from "electron";
import type { RecordingWidgetState } from "../shared/ipc";

const api = {
  requestStop: () => {
    ipcRenderer.send("recordingWidget:requestStop");
  },
  onState: (handler: (state: RecordingWidgetState) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, state: unknown) => {
      handler(state as RecordingWidgetState);
    };
    ipcRenderer.on("recordingWidget:state", listener);
    return () => {
      ipcRenderer.removeListener("recordingWidget:state", listener);
    };
  },
};

contextBridge.exposeInMainWorld("recordingWidget", api);
