export interface WorkArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WindowBoundsRequest {
  preferredWidth: number;
  preferredHeight: number;
  minWidth: number;
  minHeight: number;
  workArea: WorkArea;
  margin?: number;
}

export interface WindowBounds {
  width: number;
  height: number;
  x: number;
  y: number;
}

export function fitWindowToWorkArea({
  preferredWidth,
  preferredHeight,
  minWidth,
  minHeight,
  workArea,
  margin = 16,
}: WindowBoundsRequest): WindowBounds {
  const safeMargin = Math.max(0, margin);
  const maxWidth = Math.max(1, workArea.width - safeMargin * 2);
  const maxHeight = Math.max(1, workArea.height - safeMargin * 2);
  const boundedMinWidth = Math.min(minWidth, maxWidth);
  const boundedMinHeight = Math.min(minHeight, maxHeight);
  const width = Math.max(boundedMinWidth, Math.min(preferredWidth, maxWidth));
  const height = Math.max(boundedMinHeight, Math.min(preferredHeight, maxHeight));

  return {
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
  };
}
