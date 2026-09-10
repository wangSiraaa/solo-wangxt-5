import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

interface SampleOptions {
  pages: 8 | 11
}

/**
 * 生成内置样册（矢量 PDF）：
 * - A4 竖版，大页号
 * - 四个角标记 TOP / BOTTOM / LEFT / RIGHT，翻面对齐时一眼可看出旋转方向
 * - 页脚带书脊侧箭头提示
 */
export async function makeSamplePdf(opts: SampleOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.HelveticaBold)
  const fontN = await doc.embedFont(StandardFonts.Helvetica)
  const W = 595.28
  const H = 841.89

  for (let i = 1; i <= opts.pages; i++) {
    const page = doc.addPage([W, H])
    // 背景边框
    page.drawRectangle({
      x: 24,
      y: 24,
      width: W - 48,
      height: H - 48,
      borderColor: rgb(0.65, 0.65, 0.72),
      borderWidth: 2
    })

    const corner = (txt: string, x: number, y: number, align: 'left' | 'right' | 'center') => {
      const size = 16
      const tw = font.widthOfTextAtSize(txt, size)
      const tx = align === 'left' ? x : align === 'right' ? x - tw : x - tw / 2
      page.drawText(txt, { x: tx, y, size, font: fontN, color: rgb(0.35, 0.35, 0.4) })
    }
    corner('TOP (head)', W / 2, H - 60, 'center')
    corner('BOTTOM (foot)', W / 2, 44, 'center')
    corner('LEFT', 44, H / 2, 'left')
    corner('RIGHT', W - 44, H / 2, 'right')

    // 大页号
    const num = `PAGE ${i}`
    const ns = 110
    const nw = font.widthOfTextAtSize(num, ns)
    page.drawText(num, {
      x: (W - nw) / 2,
      y: H / 2 - ns / 2,
      size: ns,
      font,
      color: i % 2 === 1 ? rgb(0.1, 0.32, 0.72) : rgb(0.72, 0.2, 0.2)
    })

    // 顶部色块：奇数页在左、偶数页在右，拼版后检查正反面朝向
    page.drawRectangle({
      x: i % 2 === 1 ? 60 : W - 120,
      y: H - 150,
      width: 60,
      height: 60,
      color: rgb(0.95, 0.75, 0.15)
    })

    page.drawText(
      `Sample booklet · ${opts.pages} pages · arrow points to the SPINE side`,
      { x: 44, y: 70, size: 11, font: fontN, color: rgb(0.4, 0.4, 0.45) }
    )
    // 书脊侧指示（样册假设书脊在左）
    page.drawText('<< SPINE', { x: 44, y: H / 2 + 40, size: 13, font, color: rgb(0.2, 0.55, 0.25) })
  }
  return doc.save()
}
