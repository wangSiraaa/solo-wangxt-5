<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { PdfDocument } from '../lib/pdf-service'
import ThumbCanvas from './ThumbCanvas.vue'

const props = defineProps<{
  pdf: PdfDocument
  pageCount: number
  excluded: Set<number>
}>()
const emit = defineEmits<{
  (e: 'toggle-exclude', page: number): void
}>()

const pages = ref<number[]>([])
onMounted(() => {
  pages.value = Array.from({ length: props.pageCount }, (_, i) => i + 1)
})
watch(() => props.pageCount, (n) => {
  pages.value = Array.from({ length: n }, (_, i) => i + 1)
})
</script>

<template>
  <div class="card">
    <h2>原页（{{ pageCount }} 页）· 点击缩略图排除 / 恢复</h2>
    <div class="pages-strip">
      <div
        v-for="p in pages"
        :key="p"
        class="page-chip"
        :class="{ excluded: excluded.has(p) }"
        :title="excluded.has(p) ? '点击恢复该页' : '点击排除该页（不进入拼版）'"
        @click="emit('toggle-exclude', p)"
      >
        <div class="thumb">
          <ThumbCanvas :pdf="pdf" :page="p" />
        </div>
        <div class="pno">第 {{ p }} 页</div>
      </div>
    </div>
    <p class="hint" style="color:#6b7280;font-size:11px;margin:6px 0 0">
      被排除的页面不参与骑马订配对，页序按剩余页重排；可再次点击恢复，或用撤销回退。
    </p>
  </div>
</template>
