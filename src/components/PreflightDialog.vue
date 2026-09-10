<script setup lang="ts">
import { computed } from 'vue'
import type { PreflightResult } from '../lib/preflight'
import { sheetSummary } from '../lib/preflight'
import type { BuildResult } from '../lib/types'

const props = defineProps<{
  result: PreflightResult
  build: BuildResult
  exporting: boolean
}>()
const emit = defineEmits<{
  (e: 'close'): void
  (e: 'confirm'): void
}>()

const errors = computed(() => props.result.issues.filter((i) => i.level === 'error'))
const warnings = computed(() => props.result.issues.filter((i) => i.level === 'warning'))
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal">
      <header>
        <h2>导出前检查</h2>
        <button class="ghost" @click="emit('close')">关闭</button>
      </header>
      <div class="body">
        <div v-if="errors.length" class="issue error">
          <b>{{ errors.length }} 个错误必须处理</b>，当前无法导出。
        </div>
        <div v-if="warnings.length" class="issue warning">
          <b>{{ warnings.length }} 个警告</b>，请确认后再导出。
        </div>

        <div v-for="(i, idx) in result.issues" :key="idx" class="issue" :class="i.level">
          <span class="code">[{{ i.code }}]</span>{{ i.message }}
        </div>

        <h3 style="font-size:13px;margin:16px 0 6px">纸张 / 成裁参数</h3>
        <dl class="kv">
          <dt>成裁半版尺寸</dt><dd>{{ result.trimW.toFixed(1) }} × {{ result.trimH.toFixed(1) }} mm</dd>
          <dt>含出血导出页面</dt><dd>{{ result.paperW.toFixed(1) }} × {{ result.paperH.toFixed(1) }} mm</dd>
          <dt>用纸张数</dt><dd>{{ build.sheetCount }} 张（每张两页 PDF：正面 + 背面）</dd>
          <dt>成书页数</dt><dd>{{ build.totalBookletPages }} 页（含 {{ build.paddingCount }} 个补白）</dd>
        </dl>

        <h3 style="font-size:13px;margin:16px 0 6px">逐纸页序与旋转（与下载 PDF 一致）</h3>
        <table class="pagination-map">
          <thead>
            <tr><th>纸张</th><th>正面左</th><th>正面右</th><th>背面左</th><th>背面右</th></tr>
          </thead>
          <tbody>
            <tr v-for="sh in build.sheets" :key="sh.index">
              <td>{{ sh.isCoverSheet ? '封面纸' : `书芯 ${sh.index + (build.sheets.some((x) => x.isCoverSheet) ? 1 : 0)}` }}</td>
              <template v-for="side in ['front-left','front-right','back-left','back-right']" :key="side">
                <td
                  :class="{
                    blank: sh.panels.find((p) => p.side === side)?.sourcePage == null,
                    rot: sh.panels.find((p) => p.side === side)?.rotated
                  }"
                >
                  <template v-if="sh.panels.find((p) => p.side === side)?.sourcePage != null">
                    原页{{ sh.panels.find((p) => p.side === side)!.sourcePage }}
                    <div class="muted" style="font-size:10px">成书 #{{ sh.panels.find((p) => p.side === side)!.bookletNumber }}</div>
                    <div v-if="sh.panels.find((p) => p.side === side)?.rotated" style="font-size:10px">⟲180°</div>
                  </template>
                  <template v-else>
                    补白#{{ sh.panels.find((p) => p.side === side)!.bookletNumber }}
                  </template>
                </td>
              </template>
            </tr>
          </tbody>
        </table>
        <details style="margin-top:8px">
          <summary class="muted small" style="cursor:pointer">文字版页序汇总</summary>
          <p v-for="(sh, i) in build.sheets" :key="i" class="small muted" style="margin:4px 0">
            {{ sh.label }}：{{ sheetSummary(sh) }}
          </p>
        </details>
      </div>
      <footer>
        <button @click="emit('close')">返回调整</button>
        <button class="primary" :disabled="!result.ok || exporting" @click="emit('confirm')">
          {{ exporting ? '正在生成矢量 PDF…' : `确认导出（${build.sheetCount} 张纸 / ${build.sheetCount * 2} 页）` }}
        </button>
      </footer>
    </div>
  </div>
</template>
