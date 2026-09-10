// 视觉级校验：渲染导出 PDF 的每个 PDF 页为位图，检查四个象限中出现的 PAGE n，
// 以及长边翻转背面文字是否倒置（通过对比背面左右象限与期望象限）。
import { buildBooklet } from '../src/lib/imposition.ts'
import { defaultSettings } from '../src/lib/papers.ts'
import { makeSamplePdf } from '../src/lib/sample.ts'
import { exportBooklet } from '../src/lib/exporter.ts'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { createCanvas } from '/tmp/node_modules/canvas/index.js'

function assert(cond: unknown, msg: string) {
  if (!cond) { console.error('❌', msg); process.exit(1) }
  console.log('✅', msg)
}

async function renderQuads(docPdf: Awaited<ReturnType<typeof pdfjs.getDocument>['promise']>, pageNo: number) {
  const page = await docPdf.getPage(pageNo)
  const vp = page.getViewport({ scale: 1 })
  const canvas = createCanvas(Math.ceil(vp.width), Math.ceil(vp.height))
  const ctx = canvas.getContext('2d')
  await page.render({ canvasContext: ctx as unknown as CanvasRenderingContext2D, viewport: vp }).promise
  // 提取四象限文本：transform 坐标在 scale=1 时即 PDF pt（原点左下）
  const tc = await page.getTextContent()
  const quads: Record<string, number[]> = { tl: [], tr: [], bl: [], br: [] }
  for (const it of tc.items as Array<{ str: string; transform: number[] }>) {
    const m = it.str.match(/^PAGE (\d+)$/)
    if (!m) continue
    const x = it.transform[4]
    const y = it.transform[5]
    const qx = x < vp.width / 2 ? 'l' : 'r'
    const qy = y < vp.height / 2 ? 'b' : 't'
    quads[`${qy}${qx}`].push(Number(m[1]))
  }
  return quads
}

async function scenario(opts: { pages: 8 | 11; flip: 'short' | 'long' }) {
  const s = defaultSettings()
  s.flip = opts.flip
  s.bleed = 3
  const b = buildBooklet({ pageCount: opts.pages, excluded: new Set(), settings: s })
  const sample = await makeSamplePdf({ pages: opts.pages })
  const infos = Array.from({ length: opts.pages }, (_, i) => ({ page: i + 1, widthPt: 595.28, heightPt: 841.89 }))
  const bytes = await exportBooklet({ sourceBytes: sample, build: b, settings: s, pages: infos })
  const docPdf = await pdfjs.getDocument({ data: bytes.slice(0), isEvalSupported: false }).promise

  for (let sh = 0; sh < b.sheets.length; sh++) {
    const fl = b.sheets[sh].panels.find((p) => p.side === 'front-left')!
    const fr = b.sheets[sh].panels.find((p) => p.side === 'front-right')!
    const bl = b.sheets[sh].panels.find((p) => p.side === 'back-left')!
    const br = b.sheets[sh].panels.find((p) => p.side === 'back-right')!

    const front = await renderQuads(docPdf, sh * 2 + 1)
    // 正面：左半版在 tl/bl 竖条区域，右半版在 tr/br；文字正立时 PAGE n 位于半版中部偏下（下半象限更可能）
    const leftPages = [...front.tl, ...front.bl].sort()
    const rightPages = [...front.tr, ...front.br].sort()
    if (fl.sourcePage != null) assert(leftPages.includes(fl.sourcePage), `${opts.pages}页${opts.flip} 纸${sh+1}正面左象限是原页${fl.sourcePage}（实际 ${leftPages.join(',')||'补白'}）`)
    else assert(leftPages.length === 0, `${opts.pages}页${opts.flip} 纸${sh+1}正面左为补白，象限无页号`)
    if (fr.sourcePage != null) assert(rightPages.includes(fr.sourcePage), `${opts.pages}页${opts.flip} 纸${sh+1}正面右象限是原页${fr.sourcePage}（实际 ${rightPages.join(',')||'补白'}）`)

    const back = await renderQuads(docPdf, sh * 2 + 2)
    const bLeft = [...back.tl, ...back.bl].sort()
    const bRight = [...back.tr, ...back.br].sort()
    // 长边翻转：背面半版内容旋转180°，页号文本从下半象限移到上半象限
    if (opts.flip === 'long') {
      if (bl.sourcePage != null) assert(back.tl.includes(bl.sourcePage), `${opts.pages}页长边 纸${sh+1}背面左原页${bl.sourcePage}倒置（页号应在左上象限，实际 tl=${back.tl.join(',')}）`)
      if (br.sourcePage != null) assert(back.tr.includes(br.sourcePage), `${opts.pages}页长边 纸${sh+1}背面右原页${br.sourcePage}倒置（页号应在右上象限，实际 tr=${back.tr.join(',')}）`)
    } else {
      if (bl.sourcePage != null) assert(back.bl.includes(bl.sourcePage), `${opts.pages}页短边 纸${sh+1}背面左原页${bl.sourcePage}正立（页号应在左下象限，实际 bl=${back.bl.join(',')}）`)
      if (br.sourcePage != null) assert(back.br.includes(br.sourcePage), `${opts.pages}页短边 纸${sh+1}背面右原页${br.sourcePage}正立（页号应在右下象限，实际 br=${back.br.join(',')}）`)
    }
    // 补白象限不应出现任何 PAGE 文本
    for (const [pnl, set] of [[fl, leftPages], [fr, rightPages], [bl, bLeft], [br, bRight]] as const) {
      if (pnl.sourcePage == null) assert(set.length === 0, `${opts.pages}页${opts.flip} 纸${sh+1} ${pnl.side} 补白象限无页号文本`)
    }
  }
  await docPdf.destroy()
}

await scenario({ pages: 8, flip: 'short' })
await scenario({ pages: 8, flip: 'long' })
await scenario({ pages: 11, flip: 'short' })
await scenario({ pages: 11, flip: 'long' })
console.log('\n🎉 视觉位置/旋转全部符合预览模型')
