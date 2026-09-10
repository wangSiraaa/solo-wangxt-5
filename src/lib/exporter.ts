import {
  PDFDocument,
  PDFName,
  PDFOperator,
  PDFOperatorNames as Ops,
  rgb
} from 'pdf-lib'
import { MM_TO_PT, resolvePaper } from './papers'
import { computePlacement } from './placement'
import type { BuildResult, ImpositionSettings, PageInfo, Panel } from './types'

export interface ExportInput {
  sourceBytes: ArrayBuffer | Uint8Array
  build: BuildResult
  settings: ImpositionSettings
  pages: PageInfo[]
}

/**
 * 生成最终拼版 PDF：
 * - 始终嵌入源 PDF 的矢量页面（不使用任何预览位图）
 * - 半版顺序：每张纸正面（前左|前右）+ 背面（后左|后右）
 * - 长边翻转时，背面两个半版各旋转 180°
 * - 补白位置留空（不画标记，保持可印刷成品）；补白信息由预览与检查表展示
 */
export async function exportBooklet(input: ExportInput): Promise<Uint8Array> {
  const { sourceBytes, build, settings, pages } = input
  const src = await PDFDocument.load(sourceBytes)
  const out = await PDFDocument.create()
  const { widthMm, heightMm } = resolvePaper(settings)
  const W = widthMm * MM_TO_PT
  const H = heightMm * MM_TO_PT
  const b = settings.bleed * MM_TO_PT

  const pageByIdx = new Map<number, Awaited<ReturnType<PDFDocument['embedPage']>>>()
  const embed = async (p1: number) => {
    const idx = p1 - 1
    const hit = pageByIdx.get(idx)
    if (hit) return hit
    const e = await out.embedPage(src.getPages()[idx])
    pageByIdx.set(idx, e)
    return e
  }

  for (const sheet of build.sheets) {
    for (const side of ['front', 'back'] as const) {
      // 每张纸尺寸按出血外扩（出血内容延伸到纸张外）
      const page = out.addPage([W + 2 * b, H + 2 * b])
      const drawPanels = sheet.panels.filter((p) => p.side.startsWith(side))
      for (const panel of drawPanels) {
        if (panel.sourcePage == null) continue
        const info = pages[panel.sourcePage - 1]
        if (!info) continue
        const embedded = await embed(panel.sourcePage)
        const pl = computePlacement(panel, info.widthPt, info.heightPt, settings.fit)
        // 出血外扩偏移：pdf-lib 坐标整体 + (b, b)
        const ox = b
        const oy = b

        // 与预览一致的裁剪：源页包进 BBox=出血框 的 Form XObject，
        // fill 模式下超出出血框的内容被裁掉，不会越过中缝串到另一半版。
        const clip = panel.bleedBox
        const innerOps: PDFOperator[] = []
        // cm 的数字参数必须是 PDFNumber（context.obj 包装），否则写出的内容流非法
        const nums = (a: number[]) => a.map((v) => out.context.obj(v)) as unknown as Parameters<typeof PDFOperator.of>[1]
        if (pl.rotated) {
          // 180°：先绕内容框中心翻转，再应用放置矩阵
          const cx = panel.contentBox.x + panel.contentBox.w / 2
          const cy = panel.contentBox.y + panel.contentBox.h / 2
          innerOps.push(PDFOperator.of(Ops.ConcatTransformationMatrix, nums([-1, 0, 0, -1, 2 * cx, 2 * cy])))
        }
        innerOps.push(
          PDFOperator.of(Ops.ConcatTransformationMatrix, nums([pl.scale, 0, 0, pl.scale, pl.x, pl.y])),
          PDFOperator.of(Ops.DrawObject, [PDFName.of('Im0')])
        )
        const wrapperStream = out.context.formXObject(innerOps, {
          BBox: out.context.obj([clip.x, clip.y, clip.x + clip.w, clip.y + clip.h]),
          Resources: out.context.obj({ XObject: out.context.obj({ Im0: embedded.ref }) })
        })
        const wrapperRef = out.context.register(wrapperStream)
        drawXObject(page, wrapperRef, ox, oy)
      }
      if (settings.cropMarks) drawCropMarks(page, drawPanels, b)
    }
  }

  // 元数据标注：预览信息（方便打印端识别翻转方式）
  out.setTitle('Imposed booklet')
  out.setKeywords([
    `flip:${settings.flip === 'short' ? 'short-edge' : 'long-edge'}`,
    `sheets:${build.sheetCount}`,
    `bleed:${settings.bleed}mm`,
    settings.separateCover ? 'separate-cover' : 'cover-in-line'
  ])

  return out.save({ useObjectStreams: true })
}

/** 在页面上绘制 Form XObject：包装层内部用纸张 pt 坐标，这里只整体平移出血偏移 (b,b) */
function drawXObject(
  page: ReturnType<PDFDocument['addPage']>,
  ref: Parameters<ReturnType<PDFDocument['addPage']>['node']['newXObject']>[1],
  ox: number,
  oy: number
): void {
  const name = page.node.newXObject('ImposedPanel', ref as never)
  const num = (a: number[]) => a.map((v) => page.doc.context.obj(v)) as unknown as Parameters<typeof PDFOperator.of>[1]
  const ops = [
    PDFOperator.of(Ops.PushGraphicsState),
    PDFOperator.of(Ops.ConcatTransformationMatrix, num([1, 0, 0, 1, ox, oy])),
    PDFOperator.of(Ops.DrawObject, [name]),
    PDFOperator.of(Ops.PopGraphicsState)
  ]
  const streamRef = page.doc.context.register(page.doc.context.contentStream(ops, {}))
  page.node.addContentStream(streamRef)
}

/** 在每个半版的裁切线四角绘制裁切标记（位于出血区内） */
function drawCropMarks(
  page: ReturnType<PDFDocument['addPage']>,
  panels: Panel[],
  b: number
): void {
  if (b <= 0.5) return // 无出血空间则不画
  const len = Math.min(5 * MM_TO_PT, b - MM_TO_PT > 2 ? b - MM_TO_PT : b * 0.6)
  const gap = Math.max(MM_TO_PT, b - len)
  const lineW = 0.25 * MM_TO_PT
  const mark = (hx: number, hy: number, dx1: number, dy1: number, dx2: number, dy2: number) => {
    const ox = b
    const oy = b
    page.drawLine({
      start: { x: hx + dx1 * gap + ox, y: hy + dy1 * gap + oy },
      end: { x: hx + dx1 * (gap + len) + ox, y: hy + dy1 * (gap + len) + oy },
      thickness: lineW,
      color: rgb(0, 0, 0)
    })
    page.drawLine({
      start: { x: hx + dx2 * gap + ox, y: hy + dy2 * gap + oy },
      end: { x: hx + dx2 * (gap + len) + ox, y: hy + dy2 * (gap + len) + oy },
      thickness: lineW,
      color: rgb(0, 0, 0)
    })
  }
  for (const p of panels) {
    const { x, y, w, h } = p.contentBox
    // 外缘 x：右半版在右边缘，左半版在左边缘；折线侧不画，避免压折
    const ex = p.side.includes('right') ? x + w : x
    const out = p.side.includes('right') ? 1 : -1
    const corners: Array<[number, number, number, number, number, number]> = [
      // 外缘上角：向外 + 向天
      [ex, y + h, out, 0, 0, 1],
      // 外缘下角：向外 + 向地
      [ex, y, out, 0, 0, -1]
    ]
    for (const c of corners) mark(...c)
  }
}
