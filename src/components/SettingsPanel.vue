<script setup lang="ts">
import { computed } from 'vue'
import { PAPERS } from '../lib/papers'
import type { ImpositionSettings } from '../lib/types'

const props = defineProps<{
  settings: ImpositionSettings
  pageCount: number
}>()
const emit = defineEmits<{
  (e: 'change', patch: Partial<ImpositionSettings>, coalesce?: boolean): void
}>()

const set = <K extends keyof ImpositionSettings>(key: K, value: ImpositionSettings[K], coalesce = false) => {
  emit('change', { [key]: value } as Partial<ImpositionSettings>, coalesce)
}

const isCustom = computed(() => props.settings.paperId === 'custom')
</script>

<template>
  <div class="card">
    <h2>纸张</h2>
    <div class="field" style="align-items:flex-start">
      <label>纸张规格</label>
      <select
        :value="settings.paperId"
        style="width:170px"
        @change="set('paperId', ($event.target as HTMLSelectElement).value)"
      >
        <option v-for="p in PAPERS" :key="p.id" :value="p.id">{{ p.name }}</option>
      </select>
    </div>
    <template v-if="isCustom">
      <div class="field">
        <label>宽（横向，mm）</label>
        <input type="number" min="50" max="2000" step="0.5" :value="settings.customWidth"
          @input="set('customWidth', Number(($event.target as HTMLInputElement).value), true)" />
      </div>
      <div class="field">
        <label>高（mm）</label>
        <input type="number" min="50" max="2000" step="0.5" :value="settings.customHeight"
          @input="set('customHeight', Number(($event.target as HTMLInputElement).value), true)" />
      </div>
    </template>
    <p class="hint" style="margin:4px 0 0;color:#6b7280;font-size:11px">
      改变纸张规格后将自动重新检查出血与裁切范围。
    </p>
  </div>

  <div class="card">
    <h2>装订与双面翻转</h2>
    <div class="field" style="align-items:flex-start">
      <label>翻页方式</label>
      <div class="radio-row">
        <label>
          <input type="radio" name="flip" :checked="settings.flip === 'short'"
            @change="set('flip', 'short')" />短边翻转
        </label>
        <label>
          <input type="radio" name="flip" :checked="settings.flip === 'long'"
            @change="set('flip', 'long')" />长边翻转
        </label>
      </div>
    </div>
    <p class="hint" style="margin:4px 0 10px;color:#6b7280;font-size:11px">
      骑马订沿中缝（纸张短边方向）装订：短边翻转背面正立；长边翻转背面整面旋转 180°，预览会以 ⟲ 标出。
    </p>
    <div class="field">
      <label>出血（mm）</label>
      <input type="number" min="0" max="30" step="0.5" :value="settings.bleed"
        @input="set('bleed', Number(($event.target as HTMLInputElement).value), true)" />
    </div>
    <div class="field">
      <label>内容适配</label>
      <div class="radio-row">
        <label title="完整保留源页，等比缩入裁切框，可能留白">
          <input type="radio" name="fit" :checked="settings.fit === 'meet'" @change="set('fit', 'meet')" />meet 留白
        </label>
        <label title="填满出血框，超出裁切部分被裁掉">
          <input type="radio" name="fit" :checked="settings.fit === 'fill'" @change="set('fit', 'fill')" />fill 裁切
        </label>
      </div>
    </div>
    <div class="field">
      <label>爬移补偿（mm）</label>
      <input type="number" min="0" max="20" step="0.25" :value="settings.creep"
        @input="set('creep', Number(($event.target as HTMLInputElement).value), true)" />
    </div>
  </div>

  <div class="card">
    <h2>封面</h2>
    <div class="field">
      <label class="switch">
        <input type="checkbox" :checked="settings.separateCover"
          @change="set('separateCover', ($event.target as HTMLInputElement).checked)" />
        封面单独计纸
      </label>
    </div>
    <p class="hint" style="margin:0 0 8px;color:#6b7280;font-size:11px">
      开启后封面/封底独占最外一张纸（封二、封三为补白），书芯另行拼版。
    </p>
    <div class="field" v-if="settings.separateCover">
      <label>封面使用原页</label>
      <select :value="settings.coverPage ?? 1"
        @change="set('coverPage', Number(($event.target as HTMLSelectElement).value))">
        <option v-for="n in pageCount" :key="n" :value="n">第 {{ n }} 页</option>
      </select>
    </div>
    <p v-if="settings.separateCover" class="hint" style="margin:0;color:#6b7280;font-size:11px">
      封底默认取源文件最后一页；不足处自动补白并在预览中标出。
    </p>
  </div>

  <div class="card">
    <h2>导出</h2>
    <div class="field">
      <label class="switch">
        <input type="checkbox" :checked="settings.cropMarks"
          @change="set('cropMarks', ($event.target as HTMLInputElement).checked)" />
        绘制裁切标记
      </label>
    </div>
    <p class="hint" style="margin:0;color:#6b7280;font-size:11px">
      裁切标记位于出血区内、每张纸外缘上下两角；折线处不画。
    </p>
  </div>
</template>
