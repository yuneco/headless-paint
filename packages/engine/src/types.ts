export interface Point {
  x: number;
  y: number;
}

export interface Color {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface StrokePoint extends Point {
  pressure?: number;
}

export interface LayerMeta {
  name: string;
  visible: boolean;
  opacity: number;
}

export interface Layer {
  readonly width: number;
  readonly height: number;
  readonly canvas: OffscreenCanvas;
  readonly ctx: OffscreenCanvasRenderingContext2D;
  readonly meta: LayerMeta;
}
