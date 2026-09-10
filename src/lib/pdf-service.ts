import * as pdfjsLib from 'pdfjs-dist'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore Vite 的 ?worker 后缀
import PdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?worker'
import type { PDFDocumentProxy } from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerPort = new PdfWorker()

export class PdfDocument {
  bytes: ArrayBuffer
  name: string
  proxy: PDFDocumentProxy
  private cache = new Map<number, HTMLCanvasElement>()

  private constructor(bytes: ArrayBuffer, name: string, proxy: PDFDocumentProxy) {
    this.bytes = bytes
    this.name = name
    this.proxy = proxy
  }

  get pageCount(): number {
    return this.proxy.numPages
  }

  async getPageSize(page: number): Promise<{ w: number; h: number }> {
    const p = await this.proxy.getPage(page)
    const vp = p.getViewport({ scale: 1 })
    return { w: vp.width, h: vp.height }
  }

  /** 低分辨率预览图（仅用于屏幕显示，绝不用于导出）。按较长边 targetPx 渲染并缓存 */
  async renderPreview(page: number, targetLongPx = 900): Promise<HTMLCanvasElement> {
    const hit = this.cache.get(page)
    if (hit) return hit
    const p = await this.proxy.getPage(page)
    const base = p.getViewport({ scale: 1 })
    const scale = targetLongPx / Math.max(base.width, base.height)
    const vp = p.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(vp.width)
    canvas.height = Math.ceil(vp.height)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    await p.render({ canvasContext: ctx, viewport: vp }).promise
    this.cache.set(page, canvas)
    return canvas
  }

  dispose(): void {
    this.cache.clear()
    void this.proxy.destroy()
  }

  static async load(bytes: ArrayBuffer, name: string): Promise<PdfDocument> {
    const task = pdfjsLib.getDocument({ data: bytes.slice(0), isEvalSupported: false })
    const proxy = await task.promise
    return new PdfDocument(bytes, name, proxy)
  }
}
