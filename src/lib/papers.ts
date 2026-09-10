import type { ImpositionSettings, PaperSize } from './types'

export const PAPERS: PaperSize[] = [
  { id: 'a3', name: 'A3（297 × 420 mm 横向）', width: 420, height: 297 },
  { id: 'a4', name: 'A4（210 × 297 mm 横向）', width: 297, height: 210 },
  { id: 'a5', name: 'A5（148 × 210 mm 横向）', width: 210, height: 148 },
  { id: 'b4', name: 'B4（250 × 353 mm 横向）', width: 353, height: 250 },
  { id: 'b5', name: 'B5（176 × 250 mm 横向）', width: 250, height: 176 },
  { id: 'letter', name: 'Letter（279 × 216 mm 横向）', width: 279.4, height: 215.9 },
  { id: 'tabloid', name: 'Tabloid（432 × 279 mm 横向）', width: 431.8, height: 279.4 },
  { id: 'custom', name: '自定义尺寸', width: 0, height: 0 }
]

export const MM_TO_PT = 72 / 25.4

export function resolvePaper(s: ImpositionSettings): { widthMm: number; heightMm: number } {
  if (s.paperId === 'custom') return { widthMm: s.customWidth, heightMm: s.customHeight }
  const p = PAPERS.find((x) => x.id === s.paperId)
  if (!p) return { widthMm: PAPERS[0].width, heightMm: PAPERS[0].height }
  return { widthMm: p.width, heightMm: p.height }
}

export function defaultSettings(): ImpositionSettings {
  return {
    paperId: 'a3',
    customWidth: 300,
    customHeight: 220,
    flip: 'short',
    bleed: 3,
    fit: 'meet',
    separateCover: false,
    coverPage: null,
    creep: 0,
    cropMarks: false
  }
}
