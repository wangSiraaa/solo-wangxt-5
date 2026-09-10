// 临时验证脚本（node 直接跑 TS 逻辑不方便，这里复刻 JS 版冒烟测试走 dist 不可行，
// 因此用 vite-node 风格的简单 esbuild 转译执行）
import { buildBooklet } from '../src/lib/imposition.ts'
import { defaultSettings } from '../src/lib/papers.ts'
import { runPreflight, sheetSummary } from '../src/lib/preflight.ts'
import { makeSamplePdf } from '../src/lib/sample.ts'
import { exportBooklet } from '../src/lib/exporter.ts'

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error('❌ FAIL:', msg)
    process.exit(1)
  }
  console.log('✅', msg)
}

function expectSheet(build: ReturnType<typeof buildBooklet>, idx: number, sides: Record<string, string | null>) {
  const sh = build.sheets[idx]
  for (const [side, want] of Object.entries(sides)) {
    const p = sh.panels.find((x) => x.side === side)!
    const got = p.sourcePage == null ? `补白#${p.bookletNumber}` : `P${p.sourcePage}`
    assert(got === want, `纸${idx + 1} ${side}: 期望 ${want}, 实际 ${got}`)
  }
}

// ---- 8 页：短边翻转，无补白，2 张纸 ----
{
  const s = defaultSettings()
  const b = buildBooklet({ pageCount: 8, excluded: new Set(), settings: s })
  assert(b.sheetCount === 2, '8页 → 2 张纸')
  assert(b.paddingCount === 0, '8页无补白')
  // 第1张: 8|1 / 2|7
  expectSheet(b, 0, { 'front-left': 'P8', 'front-right': 'P1', 'back-left': 'P2', 'back-right': 'P7' })
  // 第2张: 6|3 / 4|5
  expectSheet(b, 1, { 'front-left': 'P6', 'front-right': 'P3', 'back-left': 'P4', 'back-right': 'P5' })
  assert(b.sheets.every((sh) => sh.panels.every((p) => !p.rotated)), '短边翻转：无旋转')
}

// ---- 8 页：长边翻转，背面全部 180° ----
{
  const s = defaultSettings()
  s.flip = 'long'
  const b = buildBooklet({ pageCount: 8, excluded: new Set(), settings: s })
  for (const sh of b.sheets) {
    assert(sh.panels.find((p) => p.side === 'front-left')!.rotated === false, '长边：正面不旋转')
    assert(sh.panels.find((p) => p.side === 'back-left')!.rotated === true, '长边：背面旋转180°')
    assert(sh.panels.find((p) => p.side === 'back-right')!.rotated === true, '长边：背面右旋转180°')
  }
}

// ---- 11 页：补 1 页 → 12 页位，补白在书芯末尾（第6面，即第2张背面右） ----
{
  const s = defaultSettings()
  const b = buildBooklet({ pageCount: 11, excluded: new Set(), settings: s })
  assert(b.totalBookletPages === 12, '11页 → 成书12页位')
  assert(b.sheetCount === 3, '11页 → 3 张纸')
  assert(b.paddingCount === 1, '11页 → 1 个补白')
  expectSheet(b, 0, { 'front-left': '补白#12', 'front-right': 'P1', 'back-left': 'P2', 'back-right': 'P11' })
  // 12 位是补白，按配对 total=12: 第1张 front-left = 12 → 补白
  const blankPanel = b.sheets[0].panels.find((p) => p.side === 'front-left')!
  assert(blankPanel.sourcePage === null && blankPanel.bookletNumber === 12, '补白位于成书页12（封底位置），红斜纹+标注')
}

// ---- 11 页 + 封面单独计纸：封面纸 + 内页补到 8（补1）= 总 12 ----
{
  const s = defaultSettings()
  s.separateCover = true
  const b = buildBooklet({ pageCount: 11, excluded: new Set(), settings: s })
  assert(b.sheets[0].isCoverSheet, '第1张为封面纸')
  assert(b.sheetCount === 4, '封面纸1 + 书芯3（内页9补到12） = 4张')
  const cover = b.sheets[0]
  void cover
  expectSheet(b, 0, { 'front-left': 'P11', 'front-right': 'P1', 'back-left': '补白#2', 'back-right': '补白#15' })
  // 书芯页 2..10 共9页 → 补到12（1 个补白，成书位 12 之前？内页序列长 12）
  // 内页序列 = 内容9 + 补3 = 12
  const innerPad = b.sheets.slice(1).flatMap((sh) => sh.panels).filter((p) => p.sourcePage === null && (p.blank?.note.includes('内页')))
  assert(innerPad.length === 3, '书芯末尾 3 个内页补白')
}

// ---- 排除页 ----
{
  const s = defaultSettings()
  const b = buildBooklet({ pageCount: 8, excluded: new Set([3]), settings: s })
  assert(b.totalBookletPages === 8, '排除后剩7页 → 补到8')
  const allSrc = b.sheets.flatMap((sh) => sh.panels).map((p) => p.sourcePage)
  assert(!allSrc.includes(3), '被排除页3不出现在拼版中')
  assert(b.paddingCount === 1, '排除1页 → 1 个补白')
}

// ---- preflight ----
{
  const s = defaultSettings()
  const b = buildBooklet({ pageCount: 11, excluded: new Set(), settings: s })
  const pages = Array.from({ length: 11 }, (_, i) => ({ page: i + 1, widthPt: 595, heightPt: 842 }))
  const pf = runPreflight({ settings: s, build: b, pages, excluded: new Set() })
  assert(pf.issues.some((i) => i.code === 'padding'), '检查报告补白')
  assert(pf.ok === true, '无错误时可导出')
  s.bleed = 500
  const pf2 = runPreflight({ settings: s, build: b, pages, excluded: new Set() })
  assert(pf2.ok === false, '出血非法 → 阻止导出')
}

// ---- 端到端：8 页样册生成 + 导出 ----
{
  const s = defaultSettings()
  const b8 = buildBooklet({ pageCount: 8, excluded: new Set(), settings: s })
  const sampleBytes = await makeSamplePdf({ pages: 8 })
  const pages = Array.from({ length: 8 }, () => ({ page: 0, widthPt: 595.28, heightPt: 841.89 })).map((p, i) => ({ ...p, page: i + 1 }))
  const out = await exportBooklet({ sourceBytes: sampleBytes, build: b8, settings: s, pages })
  assert(out.length > 10000, `8页样册导出 PDF ${out.length} 字节`)
}

// ---- 端到端：11 页 + 长边翻转 + 封面单独 ----
{
  const s = defaultSettings()
  s.flip = 'long'
  s.separateCover = true
  s.cropMarks = true
  const b11 = buildBooklet({ pageCount: 11, excluded: new Set(), settings: s })
  const sampleBytes = await makeSamplePdf({ pages: 11 })
  const pages = Array.from({ length: 11 }, (_, i) => ({ page: i + 1, widthPt: 595.28, heightPt: 841.89 }))
  const out = await exportBooklet({ sourceBytes: sampleBytes, build: b11, settings: s, pages })
  assert(out.length > 10000, `11页长边+封面单独导出 PDF ${out.length} 字节，共 ${b11.sheetCount * 2} 个 PDF 页`)
  for (const sh of b11.sheets) console.log('  ', sh.label, ':', sheetSummary(sh))
}

console.log('\n全部冒烟测试通过')
