<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  modelValue: string;
  label: string;
  metadata?: boolean;
  timestamps?: boolean;
  creationDisabled?: boolean;
  added?: boolean;
  modifiedDisabled?: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  'update:modelValue': [value: string];
  change: [];
}>();
const field = computed(() => props.modelValue.split('-')[0]);
const direction = computed(() => props.modelValue.endsWith('-desc') ? 'desc' : 'asc');
const update = (value: string) => {
  emit('update:modelValue', value);
  emit('change');
};
const changeField = (event: Event) => {
  const value = (event.target as HTMLSelectElement).value;
  update(value === 'original' ? value : `${value}-${direction.value}`);
};
const changeDirection = () => update(`${field.value}-${direction.value === 'asc' ? 'desc' : 'asc'}`);
</script>

<template>
  <div class="sort-selector">
    <button type="button" class="sort-direction" :title="direction === 'asc' ? '升序，点击切换降序' : '降序，点击切换升序'" :aria-label="`${label}方向`" @click="changeDirection" :disabled="disabled || field === 'original'">{{direction === 'asc' ? '↑' : '↓'}}</button>
    <select :aria-label="label" :value="field" @change="changeField" :disabled="disabled" class="l-input m-0 p-2 min-w-0">
      <option value="original">默认顺序</option>
      <option value="name">名称</option>
      <option value="creation" v-if="metadata || timestamps" :disabled="creationDisabled" :title="creationDisabled ? '当前来源未提供创建时间' : '来源提供的创建时间'">创建时间{{ creationDisabled ? '（无数据）' : '' }}</option>
      <option value="modified" v-if="metadata || timestamps" :disabled="modifiedDisabled" :title="modifiedDisabled ? '当前来源未提供修改时间' : '来源提供的修改时间'">修改时间{{ modifiedDisabled ? '（无数据）' : '' }}</option>
      <option value="type">类型</option>
      <option value="size" v-if="metadata">大小</option>
      <option value="created" v-if="added">添加时间</option>
    </select>
  </div>
</template>
<style scoped>
.sort-selector{display:flex;align-items:stretch;flex-shrink:0;gap:4px}.sort-selector select{width:116px;max-width:32vw}.sort-direction{border:1px solid #9ca3af;border-radius:6px;min-width:32px;font-size:22px;line-height:1;background:transparent}.sort-direction:disabled{opacity:.35;cursor:default}
</style>
