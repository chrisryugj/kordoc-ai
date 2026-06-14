import type { LayerInfo, LayerPaintOp } from '@/core/types';

export type CanvasKitReplayPlane = 'background' | 'behindText' | 'flow' | 'inFrontOfText';

export const CANVASKIT_REPLAY_PLANES = [
  'background',
  'behindText',
  'flow',
  'inFrontOfText',
] as const satisfies readonly CanvasKitReplayPlane[];

export function renderLayerReplayPlane(layer?: LayerInfo | null): CanvasKitReplayPlane {
  if (layer?.textWrap === 'behindText') {
    return 'behindText';
  }
  if (layer?.textWrap === 'inFrontOfText') {
    return 'inFrontOfText';
  }
  return 'flow';
}

export function layerPaintOpReplayPlane(
  op: LayerPaintOp,
  layer?: LayerInfo | null,
): CanvasKitReplayPlane {
  if (op.type === 'pageBackground') {
    return 'background';
  }
  if (layer?.textWrap) {
    return renderLayerReplayPlane(layer);
  }
  if (op.type === 'image') {
    if (op.wrap === 'behindText') {
      return 'behindText';
    }
    if (op.wrap === 'inFrontOfText') {
      return 'inFrontOfText';
    }
  }
  return 'flow';
}
