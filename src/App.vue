<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import SettingsPanel from './components/SettingsPanel.vue'
import PageStrip from './components/PageStrip.vue'
import SheetView from './components/SheetView.vue'
import PreflightDialog from './components/PreflightDialog.vue'
import { PdfDocument } from './lib/pdf-service'
import { makeSamplePdf } from './lib/sample'
import { buildBooklet } from './lib/imposition'
import { defaultSettings } from './lib/papers'
import type { ImpositionSettings, PageInfo, ProjectState } from './lib/types'
import { runPreflight, type PreflightResult } from './lib/preflight'
import { exportBooklet } from './lib/exporter'
import { History, type AdjustState } from './lib/history'
import * as db from './lib/db'

const pdf = shallowRef<PdfDocument | null>(null)
const fileName = ref('')
const pages = ref<PageInfo[]>([])
const settings = ref<ImpositionSettings>(defaultSettings())
const excluded = ref<Set<number>>(new Set())
const projectName = ref('未命名工程')
const dragging = ref(false)
const loading = ref(false)
const loadError = ref('')
const toast = ref('')
const showPreflight = ref(false)
const exporting = ref(false)
const savedProjects = ref<Array<{ key: string; state: ProjectState }>>([])
const draftNotice = ref<{ name: string; pageCount: number; bytes?: ArrayBuffer } | null>(null)
const preflightTick = ref(0)
const checkNotice = ref('')

const history = new History()
let toastTimer: number | undefined
let saveTimer: number | undefined
let checkTimer: number | undefined

const excludedSet = computed(() => excluded.value)

const pageSizesMap = computed(() => new Map(pages.value.map((p) => [p.page, { w: p.widthPt, h: p.heightPt }])))

/** 载入 PDF 后需要恢复的工程参数（从 IndexedDB 工程或草稿恢复时） */
let pendingRestore: { excluded?: number[]; projectName?: string } | null = null

const build = computed(() =>
  pdf.value
    ? buildBooklet({ pageCount: pdf.value.pageCount, excluded: excluded.value, settings: settings.value })
    : { sheets: [], totalBookletPages: 0, paddingCount: 0, sheetCount: 0 }
)

const preflight = computed<PreflightResult | null>(() => {
  if (!pdf.value) return null
  void preflightTick.value
  return runPreflight({
    settings: settings.value,
    build: build.value,
    pages: pages.value,
    excluded: excluded.value
  })
})

const topIssues = computed(() => {
  const p = preflight.value
  if (!p) return []
  return p.issues.filter((i) => i.level !== 'info').slice(0, 5)
})

// ---------- 文件加载 ----------
async function loadPdf(data: ArrayBuffer | Uint8Array, name: string) {
  loading.value = true
  loadError.value = ''
  try {
    const buf = data instanceof Uint8Array ? data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) : data
    const doc = await PdfDocument.load(buf, name)
    pdf.value?.dispose()
    pdf.value = doc
    fileName.value = name
    const infos: PageInfo[] = []
    for (let p = 1; p <= doc.pageCount; p++) {
      const s = await doc.getPageSize(p)
      infos.push({ page: p, widthPt: s.w, heightPt: s.h })
    }
    pages.value = infos
    if (pendingRestore?.excluded) {
      excluded.value = new Set(pendingRestore.excluded.filter((p) => p >= 1 && p <= doc.pageCount))
      if (pendingRestore.projectName) projectName.value = pendingRestore.projectName
      pendingRestore = null
    } else {
      excluded.value = new Set()
    }
    history.reset()
    scheduleDraftSave()
    showToast(`已载入 ${name}（${doc.pageCount} 页）`)
  } catch (e) {
    loadError.value = `PDF 打开失败：${(e as Error).message}`
  } finally {
    loading.value = false
  }
}

function onFile(file: File) {
  const reader = new FileReader()
  reader.onload = () => loadPdf(reader.result as ArrayBuffer, file.name)
  reader.readAsArrayBuffer(file)
}

function onPick(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0]
  if (f) onFile(f)
}

async function loadSample(n: 8 | 11) {
  loading.value = true
  const bytes = await makeSamplePdf({ pages: n })
  await loadPdf(bytes, `样册-${n}页.pdf`)
}

// ---------- 设置变更 + 撤销 ----------
function snapshot(): AdjustState {
  return { settings: JSON.parse(JSON.stringify(settings.value)), excludedPages: [...excluded.value] }
}

function patchSettings(patch: Partial<ImpositionSettings>, coalesce = false) {
  const before = snapshot()
  settings.value = { ...settings.value, ...patch }
  if (coalesce) history.coalesce(before)
  else history.push(before)
  scheduleDraftSave()
  triggerRecheck(patch)
}

function toggleExclude(p: number) {
  const before = snapshot()
  const next = new Set(excluded.value)
  if (next.has(p)) next.delete(p)
  else next.add(p)
  excluded.value = next
  history.push(before)
  scheduleDraftSave()
}

function applySnapshot(s: AdjustState) {
  settings.value = s.settings as ImpositionSettings
  excluded.value = new Set(s.excludedPages)
  scheduleDraftSave()
}

function undo() {
  const prev = history.undo(snapshot())
  if (prev) applySnapshot(prev)
}
function redo() {
  const next = history.redo(snapshot())
  if (next) applySnapshot(next)
}

function onKey(e: KeyboardEvent) {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
    e.preventDefault()
    undo()
  } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
    e.preventDefault()
    redo()
  }
}

// 纸张/出血变化后“重新检查出血与裁切范围”
function triggerRecheck(patch: Partial<ImpositionSettings>) {
  if (patch.paperId !== undefined || patch.customWidth !== undefined || patch.customHeight !== undefined) {
    checkNotice.value = '纸张规格已变更，正在重新检查出血与裁切范围…'
  } else if (patch.bleed !== undefined) {
    checkNotice.value = '出血值已变更，正在重新检查裁切范围…'
  } else {
    return
  }
  window.clearTimeout(checkTimer)
  checkTimer = window.setTimeout(() => {
    preflightTick.value++
    const pf = preflight.value
    const errs = pf?.issues.filter((i) => i.level === 'error').length ?? 0
    const warns = pf?.issues.filter((i) => i.level === 'warning').length ?? 0
    checkNotice.value = `已按新纸张重新检查：${errs} 个错误，${warns} 个警告（见侧栏“即时检查”）。`
  }, 350)
}

// ---------- IndexedDB 工程持久化 ----------
function scheduleDraftSave() {
  window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(async () => {
    if (!pdf.value) return
    const state: ProjectState = {
      name: projectName.value,
      fileName: fileName.value,
      pageCount: pdf.value.pageCount,
      settings: settings.value,
      excludedPages: [...excluded.value],
      updatedAt: Date.now()
    }
    try {
      await db.saveDraft({ ...state, pdfBytes: pdf.value.bytes.slice(0) })
    } catch {
      // 容量超限时仅保存参数
      await db.saveDraft(state)
    }
  }, 600)
}

async function saveProject() {
  if (!pdf.value) return
  const state: ProjectState = {
    name: projectName.value,
    fileName: fileName.value,
    pageCount: pdf.value.pageCount,
    settings: settings.value,
    excludedPages: [...excluded.value],
    updatedAt: Date.now()
  }
  const key = `proj:${projectName.value}`
  await db.saveProject(key, state)
  await refreshProjects()
  showToast(`工程「${projectName.value}」已保存到浏览器 IndexedDB`)
}

async function refreshProjects() {
  savedProjects.value = await db.listProjects()
}

async function restoreProject(key: string) {
  const st = await db.loadProject(key)
  if (!st) return
  projectName.value = st.name
  fileName.value = st.fileName
  settings.value = { ...st.settings }
  excluded.value = new Set(st.excludedPages)
  if (pdf.value && pdf.value.pageCount === st.pageCount) {
    history.reset()
    showToast(`已载入工程参数「${st.name}」（源 PDF 仍为当前文件）`)
  } else {
    showToast(`已载入工程参数「${st.name}」，请重新导入对应的源 PDF：${st.fileName}`)
  }
}

async function removeProject(key: string) {
  await db.deleteProject(key)
  await refreshProjects()
}

async function restoreDraft() {
  const d = draftNotice.value
  if (!d) return
  projectName.value = d.name
  pendingRestore = { excluded: excluded.value.size ? [...excluded.value] : undefined, projectName: d.name }
  if (d.bytes) {
    await loadPdf(d.bytes, d.name ? `${d.name}.pdf` : '恢复工程.pdf')
  }
  draftNotice.value = null
}

function dismissDraft() {
  draftNotice.value = null
}

// ---------- 导出 ----------
function openExport() {
  preflightTick.value++
  showPreflight.value = true
}

async function confirmExport() {
  if (!pdf.value || !preflight.value?.ok) return
  exporting.value = true
  try {
    const bytes = await exportBooklet({
      sourceBytes: pdf.value.bytes, // 原始矢量 PDF，绝不使用预览位图
      build: build.value,
      settings: settings.value,
      pages: pages.value
    })
    const blob = new Blob([bytes], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    const base = fileName.value.replace(/\.pdf$/i, '') || 'booklet'
    a.href = url
    a.download = `${base}-拼版-${build.value.sheetCount}张-${settings.value.flip === 'short' ? '短边' : '长边'}翻转.pdf`
    a.click()
    URL.revokeObjectURL(url)
    showToast('拼版 PDF 已生成并下载（嵌入原始矢量页面）')
    showPreflight.value = false
  } catch (e) {
    showToast(`导出失败：${(e as Error).message}`)
  } finally {
    exporting.value = false
  }
}

// ---------- 拖拽 ----------
function onDragOver(e: DragEvent) {
  e.preventDefault()
  dragging.value = true
}
function onDragLeave() {
  dragging.value = false
}
function onDrop(e: DragEvent) {
  e.preventDefault()
  dragging.value = false
  const f = e.dataTransfer?.files?.[0]
  if (f && f.type === 'application/pdf') onFile(f)
}

function showToast(msg: string) {
  toast.value = msg
  window.clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (toast.value = ''), 2600)
}

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  await refreshProjects()
  try {
    const d = await db.loadDraft()
    if (d) {
      draftNotice.value = { name: d.name, pageCount: d.pageCount, bytes: d.pdfBytes }
      // 参数立即恢复，PDF 字节由用户确认后载入
      projectName.value = d.name
      settings.value = { ...d.settings }
      excluded.value = new Set(d.excludedPages)
    }
  } catch {
    // IndexedDB 不可用时静默降级
  }
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKey)
  pdf.value?.dispose()
})

watch(projectName, scheduleDraftSave)
</script>

<template>
  <div class="app-shell" @dragover="onDragOver" @dragleave="onDragLeave" @drop="onDrop">
    <header class="topbar">
      <h1>骑马订小册子拼版</h1>
      <span class="sub">纯浏览器运行 · 矢量 PDF 输出 · 数据仅存本机 IndexedDB</span>
      <span class="spacer"></span>
      <template v-if="pdf">
        <button :disabled="!history.canUndo" title="Ctrl/Cmd+Z" @click="undo">↶ 撤销</button>
        <button :disabled="!history.canRedo" title="Ctrl/Cmd+Shift+Z" @click="redo">↷ 重做</button>
        <input v-model="projectName" style="width:130px" placeholder="工程名" />
        <button @click="saveProject">保存工程</button>
        <button class="primary" @click="openExport">导出前检查并下载</button>
      </template>
    </header>

    <div v-if="!pdf" class="main">
      <div class="dropzone" :class="{ drag: dragging }">
        <h2>导入源 PDF</h2>
        <p class="muted">将 PDF 拖入窗口，或</p>
        <label class="primary" style="display:inline-block;padding:6px 14px;border-radius:6px;cursor:pointer">
          选择文件
          <input type="file" accept="application/pdf" style="display:none" @change="onPick" />
        </label>
        <p v-if="loading" class="loading-note">正在解析 PDF…</p>
        <p v-if="loadError" style="color:var(--danger)">{{ loadError }}</p>

        <div class="samples">
          <button @click="loadSample(8)">载入 8 页样册</button>
          <button @click="loadSample(11)">载入 11 页样册</button>
        </div>
        <p class="muted small" style="margin-top:14px">
          样册每页带页号、方向角标与书脊箭头，可直接核对骑马订页序、补白与长短边翻转的背面方向。
        </p>

        <div v-if="draftNotice" class="card" style="margin-top:22px;text-align:left">
          <h2>恢复上次工作</h2>
          <p class="small">
            工程「{{ draftNotice.name }}」（{{ draftNotice.pageCount }} 页）的设置与源 PDF 保存在本机。
          </p>
          <button class="primary" @click="restoreDraft">恢复工程</button>
          <button @click="dismissDraft">忽略</button>
        </div>
      </div>
    </div>

    <div v-else class="workspace">
      <aside class="sidebar">
        <div class="card">
          <h2>当前文件</h2>
          <p class="small" style="margin:4px 0;word-break:break-all"><b>{{ fileName }}</b></p>
          <dl class="kv">
            <dt>源页数</dt><dd>{{ pdf.pageCount }}</dd>
            <dt>成书页数</dt><dd>{{ build.totalBookletPages }}（含补白 {{ build.paddingCount }}）</dd>
            <dt>用纸张数</dt><dd>{{ build.sheetCount }} 张（导出 {{ build.sheetCount * 2 }} 页 PDF）</dd>
          </dl>
        </div>

        <SettingsPanel :settings="settings" :page-count="pdf.pageCount" @change="patchSettings" />

        <div class="card">
          <h2>即时检查（纸张 / 出血变更自动复查）</h2>
          <p v-if="checkNotice" class="small" style="color:var(--brand)">{{ checkNotice }}</p>
          <p v-if="preflight && preflight.ok && !topIssues.length" class="small" style="color:var(--ok)">
            未发现错误与警告。
          </p>
          <div v-for="(i, idx) in topIssues" :key="idx" class="issue" :class="i.level">
            <span class="code">[{{ i.code }}]</span>{{ i.message }}
          </div>
          <button class="tiny" style="margin-top:6px" @click="preflightTick++; checkNotice='已手动重新检查出血与裁切范围。'">
            立即重新检查
          </button>
        </div>

        <div class="card" v-if="savedProjects.length">
          <h2>本机已存工程（{{ savedProjects.length }}）</h2>
          <div v-for="p in savedProjects" :key="p.key" style="display:flex;align-items:center;gap:6px;margin:6px 0">
            <button class="tiny" style="flex:1;text-align:left" @click="restoreProject(p.key)">
              {{ p.state.name }} <span class="muted">· {{ p.state.pageCount }}页 · {{ new Date(p.state.updatedAt).toLocaleDateString() }}</span>
            </button>
            <button class="tiny danger-text" @click="removeProject(p.key)">删</button>
          </div>
        </div>
      </aside>

      <main class="main">
        <div class="preview-banner">
          ⚠️ <span><b>屏幕上是低分辨率位图预览</b>（约 900px，仅供检查页序、补白与旋转）；点击“导出前检查并下载”生成的 PDF 嵌入<b>原始矢量页面</b>，不会把预览图当成品。</span>
        </div>

        <div class="legend">
          <span class="l-trim">红虚线：裁切线（成品边）</span>
          <span class="l-bleed">橙线：出血范围</span>
          <span class="l-fold">蓝虚线：中缝折线（订口）</span>
          <span class="l-rot">⟲ 180°：长边翻转的背面</span>
          <span style="color:#be3c2d">▨ 红斜纹：补白位置</span>
        </div>

        <PageStrip :pdf="pdf" :page-count="pdf.pageCount" :excluded="excludedSet" @toggle-exclude="toggleExclude" />

        <div class="sheet-grid">
          <SheetView
            v-for="sheet in build.sheets"
            :key="`${sheet.index}-${settings.flip}-${settings.paperId}-${settings.bleed}-${settings.fit}-${settings.creep}-${settings.separateCover}-${settings.cropMarks}`"
            :sheet="sheet"
            :settings="settings"
            :pdf="pdf"
            :page-sizes="pageSizesMap"
          />
        </div>
      </main>
    </div>

    <PreflightDialog
      v-if="showPreflight && preflight"
      :result="preflight"
      :build="build"
      :exporting="exporting"
      @close="showPreflight = false"
      @confirm="confirmExport"
    />

    <div v-if="toast" class="toast">{{ toast }}</div>
  </div>
</template>
