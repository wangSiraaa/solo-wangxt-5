import { MM_TO_PT, resolvePaper } from './papers'
import { computePlacement } from './placement'
import type { PdfDocument } from './pdf-service'
import type { ImpositionSettings, Panel, Sheet } from './types'

export interface RenderArgs {
  sheet: Sheet
  side: 'front' | 'back'
  settings: ImpositionSettings
  pdf: PdfDocument
  /** 页码 → 源页尺寸 pt */
  pageSizes: Map<number, { w: number; h: number }>
  cssMaxWidth: number
}

/**
 * 渲染一张纸的正面或背面到 canvas（屏幕预览）。
 * 坐标统一：pt 坐标系原点在“不含出血的纸张左下角”，canvas 原点左上，
 * 出血整体向四周外扩 b，因此像素映射为 px=(x+b)*s, py=(H+b-(y+h))*s。
 * 与导出器共用 computePlacement，保证预览 = 下载结果。
 */
export async function renderSheetCanvas(args: RenderArgs): Promise<HTMLCanvasElement> {
  const { sheet, side, settings, pdf, pageSizes, cssMaxWidth } = args
  const { widthMm, heightMm } = resolvePaper(settings)
  const W = widthMm * MM_TO_PT
  const H = heightMm * MM_TO_PT
  const b = settings.bleed * MM_TO_PT
  const fullW = W + 2 * b
  const fullH = H + 2 * b

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const s = (cssMaxWidth / fullW) * dpr

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(fullW * s)
  canvas.height = Math.round(fullH * s)
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // pt 点（PDF 坐标）→ 像素；rectX/rectY 是给定 PDF 矩形的左上角像素位置
  const px = (x: number) => (x + b) * s
  const topY = (yTop: number) => (H + b - yTop) * s
  const rect = (r: { x: number; y: number; w: number; h: number }) => ({
    rx: px(r.x),
    ry: topY(r.y + r.h),
    rw: r.w * s,
    rh: r.h * s
  })

  const panels = sheet.panels.filter((p) => p.side.startsWith(side))

  for (const panel of panels) {
    ctx.save()
    // 出血框裁剪（防止 fill 内容串到另一半 / 纸外）
    const bb = rect(panel.bleedBox)
    ctx.beginPath()
    ctx.rect(bb.rx, bb.ry, bb.rw, bb.rh)
    ctx.clip()

    if (panel.sourcePage != null) {
      const info = pageSizes.get(panel.sourcePage)
      if (info) {
        const img = await pdf.renderPreview(panel.sourcePage) // 低分辨率位图，仅用于预览
        const pl = computePlacement(panel, info.w, info.h, settings.fit)
        const dw = pl.w * s
        const dh = pl.h * s
        if (!pl.rotated) {
          ctx.drawImage(img, px(pl.x), topY(pl.y + pl.h), dw, dh)
        } else {
          // 与导出一致：绕内容框中心旋转 180°
          const cx = panel.contentBox.x + panel.contentBox.w / 2
          const cy = panel.contentBox.y + panel.contentBox.h / 2
          ctx.translate(px(cx), topY(cy))
          ctx.rotate(Math.PI)
          ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh)
        }
      }
    } else {
      // 补白：斜线底纹 + 居中标注
      const cb = rect(panel.contentBox)
      ctx.strokeStyle = 'rgba(190,60,45,0.3)'
      ctx.lineWidth = 1
      const step = 12
      for (let d = -cb.rh; d < cb.rw; d += step) {
        ctx.beginPath()
        ctx.moveTo(cb.rx + d, cb.ry)
        ctx.lineTo(cb.rx + d + cb.rh, cb.ry + cb.rh)
        ctx.stroke()
      }
    }
    ctx.restore()
  }

  drawOverlays(ctx, panels, { px, topY, rect, s, W, H, b, side, settings })
  return canvas
}

interface OverlayCtx {
  px: (x: number) => number
  topY: (yTop: number) => number
  rect: (r: { x: number; y: number; w: number; h: number }) => { rx: number; ry: number; rw: number; rh: number }
  s: number
  W: number
  H: number
  b: number
  side: 'front' | 'back'
  settings: ImpositionSettings
}

function drawOverlays(ctx: CanvasRenderingContext2D, panels: Panel[], o: OverlayCtx): void {
  // 纸张外框（裁切线处）
  ctx.strokeStyle = '#333'
  ctx.lineWidth = 1
  ctx.strokeRect(o.px(0), o.topY(o.H), o.W * o.s, o.H * o.s)

  // 折线（中缝）
  ctx.save()
  ctx.setLineDash([8, 5])
  ctx.strokeStyle = 'rgba(30,90,160,0.8)'
  ctx.beginPath()
  ctx.moveTo(o.px(o.W / 2), o.topY(0))
  ctx.lineTo(o.px(o.W / 2), o.topY(o.H))
  ctx.stroke()
  ctx.restore()

  for (const p of panels) {
    // 裁切框：红色虚线
    ctx.save()
    ctx.setLineDash([6, 4])
    ctx.strokeStyle = 'rgba(200,40,30,0.9)'
    ctx.lineWidth = 1.2
    const cb = o.rect(p.contentBox)
    ctx.strokeRect(cb.rx, cb.ry, cb.rw, cb.rh)
    ctx.restore()

    // 出血框：橙色实线
    ctx.save()
    ctx.strokeStyle = 'rgba(230,140,20,0.9)'
    ctx.lineWidth = 1
    const bb = o.rect(p.bleedBox)
    ctx.strokeRect(bb.rx, bb.ry, bb.rw, bb.rh)
    ctx.restore()

    // 信息标签
    const isRight = p.side.includes('right')
    const label =
      p.sourcePage == null
        ? `补白 #${p.bookletNumber} · ${p.blank?.note ?? ''}`
        : `原页 ${p.sourcePage} → 成书页 ${p.bookletNumber}`
    ctx.font = '11px system-ui, sans-serif'
    const tagW = ctx.measureText(label).width + 14
    const tagH = 20
    const tx = isRight ? o.px(p.contentBox.x + p.contentBox.w) - tagW - 6 : o.px(p.contentBox.x) + 6
    const ty = o.topY(p.contentBox.y + p.contentBox.h) + 6
    ctx.fillStyle = p.sourcePage == null ? 'rgba(190,60,45,0.92)' : 'rgba(20,20,24,0.78)'
    ctx.fillRect(tx, ty, tagW, tagH)
    ctx.fillStyle = '#fff'
    ctx.fillText(label, tx + 7, ty + 14)

    // 长边翻转旋转标记
    if (p.rotated) {
      ctx.font = 'bold 18px system-ui, sans-serif'
      ctx.fillStyle = 'rgba(150,30,160,0.95)'
      const txt = '⟲ 180°'
      const rx = isRight ? o.px(p.contentBox.x + p.contentBox.w) - 78 : o.px(p.contentBox.x) + 8
      ctx.fillText(txt, rx, o.topY(p.contentBox.y) - 8)
    }
  }

  // 面别 + 翻转提示
  ctx.font = 'bold 12px system-ui, sans-serif'
  ctx.fillStyle = 'rgba(30,90,160,0.95)'
  const flipText =
    o.settings.flip === 'short'
      ? `短边翻转 · ${o.side === 'front' ? '正面' : '背面（正立）'}`
      : `长边翻转 · ${o.side === 'front' ? '正面' : '背面（整面旋转 180°）'}`
  ctx.fillText(flipText, o.px(0) + 8, o.topY(o.H) + 16)
}
