// 全局类型定义：纸张 / 装订设置 / 版面结构

export type FlipMode = 'short' // 短边翻转（骑马订常规，背面正立）
  | 'long' // 长边翻转（背面相对正面旋转 180°）

export type FitMode = 'meet' | 'fill'

export type PanelSide = 'front-left' | 'front-right' | 'back-left' | 'back-right'

export interface PaperSize {
  id: string
  name: string
  /** 横向纸张尺寸（宽 > 高），单位 mm */
  width: number
  height: number
}

export interface ImpositionSettings {
  paperId: string
  customWidth: number
  customHeight: number
  /** 装订/翻页方式 */
  flip: FlipMode
  /** 出血，mm */
  bleed: number
  /** 内容适配方式：meet 保留完整页面（留白边），fill 填满出血（裁掉超出部分） */
  fit: FitMode
  /** 封面单独计纸：封面/封底独占最外一张，其余内页单独拼版 */
  separateCover: boolean
  /** 手动指定封面页（1 基），null 表示使用原页 1 */
  coverPage: number | null
  /** 爬移补偿，mm（最外一张向外位移量，向内线性减为 0） */
  creep: number
  /** 导出 PDF 时绘制裁切标记 */
  cropMarks: boolean
}

/** 一个半版（前左/前右/后左/后右）的放置信息，PDF 坐标系单位（pt） */
export interface Panel {
  side: PanelSide
  /** 1 基原页码；null 表示补白 */
  sourcePage: number | null
  /** 内容框（裁切框），pt，PDF 坐标（原点左下） */
  contentBox: { x: number; y: number; w: number; h: number }
  /** 该半版出血区域（导出时页面实际覆盖区域），pt */
  bleedBox: { x: number; y: number; w: number; h: number }
  /** 相对半版内容框是否旋转 180°（长边翻转的背面） */
  rotated: boolean
  /** 页码在骑马订成书后的位置（1 基，含补白占位号） */
  bookletNumber: number
  blank?: {
    kind: 'padding'
    /** 补白说明，如 “内页补白” */
    note: string
  }
  excluded?: boolean
}

export interface Sheet {
  /** 帖序，0 = 最外层（封面纸或第一张） */
  index: number
  isCoverSheet: boolean
  label: string
  panels: Panel[]
}

export interface PageInfo {
  /** 1 基页码 */
  page: number
  widthPt: number
  heightPt: number
}

export interface BuildResult {
  sheets: Sheet[]
  /** 成书总页数（含补白），4 的倍数 */
  totalBookletPages: number
  paddingCount: number
  /** 实际参与拼版的纸张数 */
  sheetCount: number
  /** 每张纸正反面信息汇总，供检查视图使用 */
}

export interface ProjectState {
  name: string
  fileName: string
  pageCount: number
  settings: ImpositionSettings
  /** 被排除的原页码（1 基） */
  excludedPages: number[]
  updatedAt: number
}
