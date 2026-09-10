<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import type { PdfDocument } from '../lib/pdf-service'

const props = defineProps<{
  pdf: PdfDocument
  page: number
  /** 预览图较长边像素（屏幕显示用低分辨率位图） */
  target?: number
}>()

const el = ref<HTMLCanvasElement | null>(null)

async function draw() {
  const canvas = el.value
  if (!canvas) return
  const img = await props.pdf.renderPreview(props.page, props.target ?? 220)
  canvas.width = img.width
  canvas.height = img.height
  canvas.getContext('2d')!.drawImage(img, 0, 0)
}

onMounted(draw)
watch(() => props.page, draw)
watch(() => props.pdf, draw)
</script>

<template>
  <canvas ref="el"></canvas>
</template>
