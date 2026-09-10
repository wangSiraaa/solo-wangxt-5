import { MM_TO_PT, PAPERS, resolvePaper } from './papers'
import type { BuildResult, ImpositionSettings, PageInfo, Panel, Sheet } from './types'

export type IssueLevel = 'error' | 'warning' | 'info'

export interface Issue {
  level: IssueLevel
  code: string
  message: string
}

export interface PreflightResult {
  issues: Issue[]
  ok: boolean
  /** 成裁尺寸（半版），mm */
  trimW: number
  trimH: number
  /** 出血后实际用纸，mm */
  paperW: number
  paperH: number
}

interface Input {
  settings: ImpositionSettings
  build: BuildResult
  pages: PageInfo[]
  excluded: Set<number>
}

/** 导出前检查：纸张/出血、补白、排除页、翻转方向、爬移、分辨率等 */
export function runPreflight({ settings, build, pages, excluded }: Input): PreflightResult {
  const issues: Issue[] = []
  const { widthMm, heightMm } = resolvePaper(settings)
  const trimW = widthMm / 2
  const trimH = heightMm
  const b = settings.bleed
  const paperW = widthMm + 2 * b
  const paperH = heightMm + 2 * b

  // 1. 纸张有效性
  if (!(widthMm > 0 && heightMm > 0)) {
    issues.push({ level: 'error', code: 'paper', message: '纸张尺寸无效，请检查自定义宽高。' })
  }

  // 2. 出血 vs 成裁
  if (b < 1) {
    issues.push({ level: 'warning', code: 'bleed', message: '出血小于 1 mm，常见印刷要求为 3 mm。' })
  }
  if (b > trimW / 2) {
    issues.push({ level: 'error', code: 'bleed', message: `出血 ${b} mm 超过成裁宽度的一半（${fmt(trimW / 2)} mm）。` })
  }

  // 3. 源页与成裁尺寸（出血与裁切范围复核）
  if (pages.length > 0) {
    for (const p of pages) {
      if (excluded.has(p.page)) continue
      const wMm = p.widthPt / MM_TO_PT
      const hMm = p.heightPt / MM_TO_PT
      const targetRatio = trimW / trimH
      const srcRatio = wMm / hMm
      const ratioDiff = Math.abs(srcRatio - targetRatio) / targetRatio
      if (ratioDiff > 0.08) {
        issues.push({
          level: 'warning',
          code: 'ratio',
          message: `原页 ${p.page} 比例 ${fmt(wMm)}×${fmt(hMm)} mm 与成裁 ${fmt(trimW)}×${fmt(trimH)} mm 差异较大，${
            settings.fit === 'meet' ? 'meet 模式会出现较宽白边' : 'fill 模式将裁掉较多内容'
          }。`
        })
      }
      if (settings.fit === 'meet') {
        // meet 下整页等比缩入裁切框，检查留白
        const scale = Math.min(trimW / wMm, trimH / hMm)
        const placedW = wMm * scale
        const placedH = hMm * scale
        if (placedW < trimW - 1 || placedH < trimH - 1) {
          issues.push({
            level: 'info',
            code: 'meet-gap',
            message: `原页 ${p.page} 在 meet 模式下放置尺寸 ${fmt(placedW)}×${fmt(placedH)} mm，裁切后存在白边（满版内容请改用 fill 或加大出血）。`
          })
        }
      }
    }
  }

  // 4. 页数 / 补白
  if (build.paddingCount > 0) {
    const locs = describePadding(build)
    issues.push({
      level: 'warning',
      code: 'padding',
      message: `存在 ${build.paddingCount} 个补白页（非 4 的倍数），位置：${locs}。补白在导出 PDF 中为空白页。`
    })
  }

  // 5. 排除页
  if (excluded.size > 0) {
    issues.push({
      level: 'info',
      code: 'excluded',
      message: `以下原页已排除、不会进入拼版：${[...excluded].sort((a, b2) => a - b2).join('、')}。`
    })
  }

  // 6. 封面单独计纸
  if (settings.separateCover) {
    issues.push({
      level: 'info',
      code: 'cover',
      message: '封面单独计纸：封面纸（封面/封二/封三/封底）独占一张，书芯另算。'
    })
    if (settings.coverPage != null && settings.coverPage > pages.length) {
      issues.push({ level: 'error', code: 'cover', message: '指定的封面页码超出源文件页数。' })
    }
  }

  // 7. 翻转方向
  if (settings.flip === 'long') {
    issues.push({
      level: 'info',
      code: 'flip',
      message: '长边翻转：每张纸背面两个半版相对正面旋转 180°（预览中以 ⟲ 标记），与短边翻转不同。'
    })
  } else {
    issues.push({
      level: 'info',
      code: 'flip',
      message: '短边翻转（骑马订常规）：背面正立，沿纸张短边（折线）翻页。'
    })
  }

  // 8. 爬移
  if (settings.creep > 0) {
    const maxShift = settings.creep
    if (maxShift > trimW / 4) {
      issues.push({
        level: 'warning',
        code: 'creep',
        message: `爬移 ${settings.creep} mm 偏大，最外层位移 ${fmt(maxShift)} mm，注意别让重要内容越过裁切线。`
      })
    } else {
      issues.push({ level: 'info', code: 'creep', message: `爬移补偿 ${settings.creep} mm：最外层向书口位移，向内线性减为 0。` })
    }
  }

  // 9. 裁切标记
  if (settings.cropMarks && b < 2) {
    issues.push({ level: 'warning', code: 'marks', message: '出血过小，裁切标记可能与成品重叠，建议至少 2 mm 出血。' })
  }

  // 10. 纸张切换提示：给出当前纸张名称方便确认
  const paperName = settings.paperId === 'custom'
    ? `自定义 ${widthMm}×${heightMm} mm`
    : PAPERS.find((p) => p.id === settings.paperId)?.name ?? ''
  issues.push({
    level: 'info',
    code: 'paper',
    message: `当前用纸 ${paperName}；成裁（半版）${fmt(trimW)}×${fmt(trimH)} mm；含出血实际页面 ${fmt(paperW)}×${fmt(paperH)} mm；共 ${build.sheetCount} 张纸。`
  })

  return {
    issues,
    ok: !issues.some((i) => i.level === 'error'),
    trimW,
    trimH,
    paperW,
    paperH
  }
}

function describePadding(build: BuildResult): string {
  const out: string[] = []
  for (const sh of build.sheets) {
    for (const p of sh.panels) {
      if (p.sourcePage == null && p.blank) {
        out.push(`成书页 ${p.bookletNumber}（${sideName(p.side)}，${p.blank.note}）`)
      }
    }
  }
  return out.join('；') || '无'
}

export function sideName(side: Panel['side']): string {
  return {
    'front-left': '正面左侧',
    'front-right': '正面右侧',
    'back-left': '背面左侧',
    'back-right': '背面右侧'
  }[side]
}

export function sheetSummary(sheet: Sheet): string {
  return sheet.panels
    .map((p) => `${sideName(p.side)}=${p.sourcePage == null ? `补白#${p.bookletNumber}` : `原页${p.sourcePage}`}${p.rotated ? '(旋转180°)' : ''}`)
    .join('，')
}

function fmt(n: number): string {
  return Math.round(n * 10) / 10 + ''
}
