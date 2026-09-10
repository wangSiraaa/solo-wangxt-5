import type { FitMode, Panel } from './types'

/**
 * 计算源页在半版中的放置（未旋转状态）。
 * - meet：完整保留源页，等比缩放到内容框，可能留白
 * - fill：等比填满出血框，超出部分裁掉
 * 返回 PDF 坐标系（原点左下）下的目标框与缩放，旋转 180° 时由调用方统一处理。
 */
export interface Placement {
  x: number
  y: number
  w: number
  h: number
  scale: number
  rotated: boolean
}

export function computePlacement(
  panel: Panel,
  srcW: number,
  srcH: number,
  fit: FitMode
): Placement {
  const target = fit === 'fill' ? panel.bleedBox : panel.contentBox
  const scale =
    fit === 'fill'
      ? Math.max(target.w / srcW, target.h / srcH)
      : Math.min(panel.contentBox.w / srcW, panel.contentBox.h / srcH)
  const w = srcW * scale
  const h = srcH * scale
  // meet 模式始终在内容框内居中；fill 在出血框内居中
  const cx = target.x + target.w / 2
  const cy = target.y + target.h / 2
  return {
    x: cx - w / 2,
    y: cy - h / 2,
    w,
    h,
    scale,
    rotated: panel.rotated
  }
}

/** 预览画布的像素尺寸（含出血外扩） */
export function canvasSize(
  paperWPt: number,
  paperHPt: number,
  bleedPt: number,
  cssMaxW: number
): { cssW: number; cssH: number; dprScale: number } {
  const scale = cssMaxW / (paperWPt + 2 * bleedPt)
  return {
    cssW: (paperWPt + 2 * bleedPt) * scale,
    cssH: (paperHPt + 2 * bleedPt) * scale,
    dprScale: scale
  }
}
