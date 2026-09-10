import { MM_TO_PT, resolvePaper } from './papers'
import type { BuildResult, ImpositionSettings, Panel, PanelSide, Sheet } from './types'

interface Slot {
  /** 原页码 1 基；null = 补白 */
  page: number | null
  excluded?: boolean
  blankNote?: string
  /** 成书页位（1 基，含补白占位） */
  bookletNumber: number
}

/** 骑马订标准配对：给定帖序 k（0 = 最外层），返回四个半版对应的成书页位（1 基） */
export function saddlePair(k: number, total: number): Record<PanelSide, number> {
  return {
    'front-left': total - 2 * k,
    'front-right': 1 + 2 * k,
    'back-left': 2 + 2 * k,
    'back-right': total - 1 - 2 * k
  }
}

const SIDES: PanelSide[] = ['front-left', 'front-right', 'back-left', 'back-right']

interface BuildInput {
  pageCount: number
  excluded: Set<number>
  settings: ImpositionSettings
}

/**
 * 根据设置构建整套纸张：
 * - 标准骑马订配对（最外层为封面/封底）
 * - separateCover：封面纸独占一张（封面 / 封二补白 / 封三补白 / 封底）
 * - 补白一律放在书芯末尾，明确标记位置
 */
export function buildBooklet(input: BuildInput): BuildResult {
  const { pageCount, excluded, settings } = buildInputGuard(input)
  const { widthMm, heightMm } = resolvePaper(settings)
  const W = widthMm * MM_TO_PT
  const H = heightMm * MM_TO_PT
  const b = settings.bleed * MM_TO_PT

  // 全局成书页位序列（含补白），同时产出若干“配对序列”
  let globalSlots: Slot[]
  /** 每个配对序列：独立按骑马订配对 */
  let sequences: { isCover: boolean; slots: Slot[] }[]

  if (!settings.separateCover) {
    const pages: number[] = []
    for (let p = 1; p <= pageCount; p++) if (!excluded.has(p)) pages.push(p)
    const pad = (4 - (pages.length % 4)) % 4
    globalSlots = pages.map((page, i) => ({ page, bookletNumber: i + 1 }))
    for (let i = 0; i < pad; i++) {
      globalSlots.push({ page: null, bookletNumber: globalSlots.length + 1, blankNote: '书尾补白' })
    }
    sequences = [{ isCover: false, slots: globalSlots }]
  } else {
    const coverPage = settings.coverPage ?? 1
    const backCoverCandidate = pageCount
    // 封面 / 封底：被排除或缺页时回退为补白
    const coverValid = coverPage >= 1 && coverPage <= pageCount && !excluded.has(coverPage)
    let backPage: number | null =
      backCoverCandidate >= 1 && backCoverCandidate <= pageCount && !excluded.has(backCoverCandidate)
        ? backCoverCandidate
        : null
    if (backPage === coverPage) backPage = null

    const used = new Set<number>()
    if (coverValid) used.add(coverPage)
    if (backPage != null) used.add(backPage)

    const contentPages: number[] = []
    for (let p = 1; p <= pageCount; p++) {
      if (!used.has(p) && !excluded.has(p)) contentPages.push(p)
    }
    const pad = (4 - (contentPages.length % 4)) % 4
    const totalAll = 4 + contentPages.length + pad

    // 全局成书页位：1 封面，2 封二，内容 3..，封三 / 封底收尾
    globalSlots = [
      { page: coverValid ? coverPage : null, bookletNumber: 1, blankNote: coverValid ? undefined : '封面补白（指定封面缺失/被排除）' },
      { page: null, bookletNumber: 2, blankNote: '封二补白（封面纸内侧）' }
    ]
    contentPages.forEach((page, i) => globalSlots.push({ page, bookletNumber: 3 + i }))
    for (let i = 0; i < pad; i++) {
      globalSlots.push({ page: null, bookletNumber: globalSlots.length + 1, blankNote: '内页补白（书芯末尾）' })
    }
    globalSlots.push({ page: null, bookletNumber: totalAll - 1, blankNote: '封三补白（封面纸内侧）' })
    globalSlots.push({
      page: backPage,
      bookletNumber: totalAll,
      blankNote: backPage == null ? '封底补白' : undefined
    })

    // 封面配对序列：[封面, 封二, 封三, 封底]
    const coverSeq: Slot[] = [
      globalSlots[0],
      globalSlots[1],
      globalSlots[totalAll - 2],
      globalSlots[totalAll - 1]
    ]
    const innerSeq = globalSlots.slice(2, totalAll - 2)
    sequences = [
      { isCover: true, slots: coverSeq },
      { isCover: false, slots: innerSeq }
    ].filter((s) => s.slots.length > 0)
  }

  const totalSheets = sequences.reduce((acc, s) => acc + s.slots.length / 4, 0)
  const sheets: Sheet[] = []
  let globalIndex = 0

  for (const seq of sequences) {
    const T = seq.slots.length
    const seqSheets = T / 4
    for (let k = 0; k < seqSheets; k++) {
      const pair = saddlePair(k, T)
      const creepMm =
        settings.creep > 0 && totalSheets > 1
          ? settings.creep * ((totalSheets - 1 - globalIndex) / (totalSheets - 1))
          : 0
      const dx = creepMm * MM_TO_PT
      const panels = SIDES.map((side): Panel => {
        const slot = seq.slots[pair[side] - 1]
        const isRight = side === 'front-right' || side === 'back-right'
        // 内容（裁切）框
        const contentBox = {
          x: (isRight ? W / 2 : 0) + (isRight ? dx : -dx),
          y: 0,
          w: W / 2,
          h: H
        }
        // 出血框：外侧天头地头出血，订口（折线侧）不出血
        const bleedBox = isRight
          ? { x: W / 2 + dx, y: -b, w: W / 2 + b, h: H + 2 * b }
          : { x: -b - dx, y: -b, w: W / 2 + b, h: H + 2 * b }
        const rotated = settings.flip === 'long' && (side === 'back-left' || side === 'back-right')
        return {
          side,
          sourcePage: slot.page,
          contentBox,
          bleedBox,
          rotated,
          bookletNumber: slot.bookletNumber,
          blank: slot.page == null ? { kind: 'padding', note: slot.blankNote ?? '补白' } : undefined,
          excluded: slot.excluded
        }
      })
      sheets.push({ index: globalIndex, isCoverSheet: seq.isCover, label: '', panels })
      globalIndex++
    }
  }

  // 纸张标签：封面纸单独命名，书芯连续编号
  let innerNo = 0
  for (const sh of sheets) {
    if (sh.isCoverSheet) {
      sh.label = `封面纸（封面 / 封底，单独计纸）· 第 ${sh.index + 1}/${totalSheets} 张`
    } else {
      innerNo++
      sh.label = `书芯纸 ${innerNo} · 第 ${sh.index + 1}/${totalSheets} 张`
    }
  }

  return {
    sheets,
    totalBookletPages: globalSlots.length,
    paddingCount: globalSlots.filter((s) => s.page == null).length,
    sheetCount: totalSheets
  }
}

function buildInputGuard(input: BuildInput): BuildInput {
  return {
    pageCount: Math.max(0, Math.floor(input.pageCount)),
    excluded: input.excluded,
    settings: input.settings
  }
}
