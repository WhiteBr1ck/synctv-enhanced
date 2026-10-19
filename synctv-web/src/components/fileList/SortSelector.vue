<script setup lang="ts">
import { computed } from "vue";

const props = defineProps<{
  modelValue: string;
  label: string;
  metadata?: boolean;
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
const changeDirection = (event: Event) => {
  update(`${field.value}-${(event.target as HTMLSelectElement).value}`);
};
</script>

<template>
  <div class="my-3 flex items-center gap-2">
    <span>排序</span>
    <select :aria-label="label" :value="field" @change="changeField" :disabled="disabled" class="l-input m-0 p-2 flex-1 min-w-0">
      <option value="original">默认顺序</option>
      <option value="name">名称</option>
      <option value="modified" v-if="metadata" :disabled="modifiedDisabled">修改时间</option>
      <option value="type">类型</option>
      <option value="size" v-if="metadata">大小</option>
      <option value="created" v-if="added">添加时间</option>
    </select>
    <select :aria-label="`${label}方向`" :value="field === 'original' ? 'original' : direction" @change="changeDirection" :disabled="disabled || field === 'original'" class="l-input m-0 p-2 w-24">
      <option value="original" v-if="field === 'original'">默认</option>
      <option value="asc">升序 ↑</option>
      <option value="desc">降序 ↓</option>
    </select>
  </div>
</template>
