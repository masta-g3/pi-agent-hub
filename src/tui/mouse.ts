export const MOUSE_ENABLE = "\x1b[?1000;1006h";
export const MOUSE_DISABLE = "\x1b[?1000;1006l";

export type MouseEvent =
  | { kind: "press"; x: number; y: number }
  | { kind: "wheel"; delta: -1 | 1; x?: number; y?: number };

export function isMouseSequence(data: string): boolean {
  return data.startsWith("\x1b[<") || data.startsWith("\x1b[M");
}

export function parseMouseEvent(data: string): MouseEvent | undefined {
  const match = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/.exec(data);
  if (!match) return undefined;
  const [, buttonText, xText, yText, suffix] = match;
  const button = Number(buttonText);
  if (button === 64) return { kind: "wheel", delta: -1, x: Number(xText), y: Number(yText) };
  if (button === 65) return { kind: "wheel", delta: 1, x: Number(xText), y: Number(yText) };
  if (button === 0 && suffix === "M") return { kind: "press", x: Number(xText), y: Number(yText) };
  return undefined;
}
