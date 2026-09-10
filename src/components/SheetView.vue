<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { renderSheetCanvas } from '../lib/render-sheet'
import type { PdfDocument } from '../lib/pdf-service'
import type { ImpositionSettings, Sheet } from '../lib/types'
import { sideName } from '../lib/preflight'

const props = defineProps<{
  sheet: Sheet
  settings: ImpositionSettings
  pdf: PdfDocument
  pageSizes: Map<number, { w: number; h: number }>
}>()

const frontEl = ref<HTMLCanvasElement | null>(null)
const backEl = ref<HTMLCanvasElement | null>(null)
const rendering = ref(true)
let token = 0

async function render() {
  const t = ++token
  rendering.value = true
  const maxW = 520
  const [front, back] = await Promise.all([
    renderSheetCanvas({ sheet: props.sheet, side: 'front', settings: props.settings, pdf: props.pdf, pageSizes: props.pageSizes, cssMaxWidth: maxW }),
    renderSheetCanvas({ sheet: props.sheet, side: 'back', settings: props.settings, pdf: props.pdf, pageSizes: props.pageSizes, cssMaxWidth: maxW })
  ])
  if (t !== token) return
  blit(frontEl.value, front)
  blit(backEl.value, back)
  rendering.value = false
}

function blit(target: HTMLCanvasElement | null, src: HTMLCanvasElement) {
  if (!target) return
  target.width = src.width
  target.height = src.height
  target.getContext('2d')!.drawImage(src, 0, 0)
}

onMounted(render)
watch(() => [props.sheet, props.settings, props.pageSizes], render, { deep: true })

function panel(side: 'front' | 'back', half: 'left' | 'right') {
  return props.sheet.panels.find((p) => p.side === `${side}-${half}`)
}
</script>

<template>
  <div class="sheet-card" :class="{ cover: sheet.isCoverSheet }">
    <div class="sheet-head">
      <strong>{{ sheet.label }}</strong>
      <span class="tag" :class="{ cover: sheet.isCoverSheet }">
        {{ sheet.isCoverSheet ? '封面单独计纸' : '书芯' }}
      </span>
      <span class="tag">{{ settings.flip === 'short' ? '短边翻转' : '长边翻转' }}</span>
      <span v-if="sheet.panels.some((p) => p.sourcePage == null)" class="tag" style="background:#fdf1f0;color:#c8281e">
        含 {{ sheet.panels.filter((p) => p.sourcePage == null).length }} 处补白
      </span>
    </div>

    <div class="sheet-faces">
      <div class="face">
        <h3>正面（印刷面 A）</h3>
        <canvas ref="frontEl"></canvas>
        <p class="small muted" style="margin:6px 0 0">
          <template v-for="p in [panel('front','left'), panel('front','right')]" :key="p!.side">
            <span :style="p!.sourcePage == null ? 'color:#c8281e;font-weight:600' : ''">
              {{ sideName(p!.side) }}：
              <template v-if="p!.sourcePage != null">原页 {{ p!.sourcePage }} → 成书页 {{ p!.bookletNumber }}</template>
              <template v-else>补白（成书页 {{ p!.bookletNumber }}，{{ p!.blank?.note }}）</template>
            </span>
            <br v-if="p === panel('front','left')" />
          </template>
        </p>
      </div>
      <div class="face">
        <h3>
          背面（印刷面 B）
          <span v-if="settings.flip === 'long'" style="color:#961ea0">⟲ 长边翻转后整面旋转 180°</span>
          <span v-else style="color:#2f8f46">短边翻转后正立</span>
        </h3>
        <canvas ref="backEl"></canvas>
        <p class="small muted" style="margin:6px 0 0">
          <template v-for="p in [panel('back','left'), panel('back','right')]" :key="p!.side">
            <span :style="p!.sourcePage == null ? 'color:#c8281e;font-weight:600' : ''">
              {{ sideName(p!.side) }}：
              <template v-if="p!.sourcePage != null">原页 {{ p!.sourcePage }} → 成书页 {{ p!.bookletNumber }}</template>
              <template v-else>补白（成书页 {{ p!.bookletNumber }}，{{ p!.blank?.note }}）</template>
              <template v-if="p!.rotated"> ⟲旋转180°</template>
            </span>
            <br v-if="p === panel('back','left')" />
          </template>
        </p>
      </div>
    </div>
    <p v-if="rendering" class="loading-note">正在渲染预览…</p>
  </div>
</template>
