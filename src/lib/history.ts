/** 撤销 / 重做：保存可调整状态（设置 + 排除页）的深拷贝快照 */
export interface AdjustState {
  settings: unknown
  excludedPages: number[]
}

export class History {
  private stack: AdjustState[] = []
  private future: AdjustState[] = []
  private limit = 50
  private pending: AdjustState | null = null
  private timer: number | null = null

  /** 立即入栈一次离散操作（排除/恢复页等） */
  push(state: AdjustState): void {
    this.cancelPending()
    this.stack.push(clone(state))
    if (this.stack.length > this.limit) this.stack.shift()
    this.future = []
  }

  /** 合并连续快速变更（滑杆 / 输入），停顿后固化 */
  coalesce(state: AdjustState): void {
    if (this.timer != null) {
      this.pending = clone(state)
      return
    }
    this.stack.push(clone(state))
    if (this.stack.length > this.limit) this.stack.shift()
    this.future = []
    this.pending = clone(state)
    this.schedule()
  }

  private schedule(): void {
    this.timer = window.setTimeout(() => {
      if (this.pending) {
        // 用最终值替换栈顶
        this.stack[this.stack.length - 1] = this.pending
        this.pending = null
      }
      this.timer = null
    }, 500)
  }

  private cancelPending(): void {
    if (this.timer != null) {
      window.clearTimeout(this.timer)
      this.timer = null
      this.pending = null
    }
  }

  undo(current: AdjustState): AdjustState | null {
    this.cancelPending()
    const prev = this.stack.pop()
    if (!prev) return null
    this.future.push(clone(current))
    return prev
  }

  redo(current: AdjustState): AdjustState | null {
    const next = this.future.pop()
    if (!next) return null
    this.stack.push(clone(current))
    return next
  }

  get canUndo(): boolean {
    return this.stack.length > 0
  }

  get canRedo(): boolean {
    return this.future.length > 0
  }

  reset(): void {
    this.cancelPending()
    this.stack = []
    this.future = []
  }
}

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}
