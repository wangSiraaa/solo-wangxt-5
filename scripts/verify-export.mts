import { buildBooklet } from '../src/lib/imposition.ts'
import { defaultSettings } from '../src/lib/papers.ts'
import { makeSamplePdf } from '../src/lib/sample.ts'
import { exportBooklet } from '../src/lib/exporter.ts'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'

async function check(name: string, opts: { pages: 8 | 11; flip: 'short' | 'long'; cover: boolean; bleed: number }) {
  const s = defaultSettings()
  s.flip = opts.flip
  s.separateCover = opts.cover
  s.bleed = opts.bleed
  const b = buildBooklet({ pageCount: opts.pages, excluded: new Set(), settings: s })
  const sample = await makeSamplePdf({ pages: opts.pages })
  const pageInfos = Array.from({ length: opts.pages }, (_, i) => ({ page: i + 1, widthPt: 595.28, heightPt: 841.89 }))
  const bytes = await exportBooklet({ sourceBytes: sample, build: b, settings: s, pages: pageInfos })

  const task = pdfjs.getDocument({ data: bytes.slice(0), isEvalSupported: false })
  const doc = await task.promise
  const expectedPdfPages = b.sheetCount * 2
  if (doc.numPages !== expectedPdfPages) throw new Error(`${name}: PDF 页数 ${doc.numPages} ≠ ${expectedPdfPages}`)

  // 每页文本包含哪些 “PAGE n”
  const layout: Array<Record<string, number | null>> = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const vp = page.getViewport({ scale: 1 })
    // A3 横向 420x297mm + 2*bleed
    const expectW = (420 + 2 * opts.bleed) * (72 / 25.4)
    const expectH = (297 + 2 * opts.bleed) * (72 / 25.4)
    if (Math.abs(vp.width - expectW) > 1 || Math.abs(vp.height - expectH) > 1) {
      throw new Error(`${name} PDF页${i} 尺寸 ${vp.width.toFixed(1)}x${vp.height.toFixed(1)} ≠ ${expectW.toFixed(1)}x${expectH.toFixed(1)}`)
    }
    const tc = await page.getTextContent()
    const text = tc.items.map((it: any) => it.str).join(' ')
    const m = [...text.matchAll(/PAGE (\d+)/g)].map((x) => Number(x[1]))
    const face = b.sheets[Math.floor((i - 1) / 2)].panels.filter((p) => p.side.startsWith(i % 2 === 1 ? 'front' : 'back'))
    const want = face.map((p) => p.sourcePage)
    const got = want.map((w) => (w == null ? null : (m.includes(w) ? w : -1)))
    layout.push(Object.fromEntries(face.map((p, k) => [p.side, got[k] ?? null])))
  }

  // 逐格比对：补白格文本无 PAGE，原页格必须能提取到对应 PAGE n
  for (let sh = 0; sh < b.sheets.length; sh++) {
    for (const faceIdx of [0, 1] as const) {
      const faceName = faceIdx === 0 ? 'front' : 'back'
      const pdfPageNo = sh * 2 + faceIdx + 1
      const detected = layout[pdfPageNo - 1]
      for (const panel of b.sheets[sh].panels.filter((p) => p.side.startsWith(faceName))) {
        const gotPage = detected[panel.side]
        if (panel.sourcePage == null) {
          if (gotPage != null) throw new Error(`${name} 纸${sh + 1}${faceName}${panel.side} 应为补白却检测到 PAGE ${gotPage}`)
        } else if (gotPage !== panel.sourcePage) {
          throw new Error(`${name} 纸${sh + 1}${faceName}${panel.side} 应为原页 ${panel.sourcePage}，检测到 ${gotPage}`)
        }
      }
    }
  }
  console.log(`✅ ${name}: ${doc.numPages} PDF页, 尺寸/页序/补白全部与预览模型一致`)
  return doc.destroy()
}

await check('8页-短边-封面内联', { pages: 8, flip: 'short', cover: false, bleed: 3 })
await check('8页-长边-封面内联', { pages: 8, flip: 'long', cover: false, bleed: 3 })
await check('11页-短边-封面单独', { pages: 11, flip: 'short', cover: true, bleed: 5 })
await check('11页-长边-封面单独', { pages: 11, flip: 'long', cover: true, bleed: 0 })
console.log('\n导出 PDF 实测全部通过')
