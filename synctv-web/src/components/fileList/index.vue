<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useLocalStorage } from "@vueuse/core";
import type { FileList, FileItem } from "@/types/Vendor";
import SortSelector from "./SortSelector.vue";
import { ArrowRight, Folder, Document, Search, Plus } from "@element-plus/icons-vue";

const props = defineProps<{
  fileList: FileList | undefined;
  isLoading: boolean;
  enableSearch: boolean;
  metadata?: boolean;
}>();

const emit = defineEmits<{
  toDir: [path: string, page: number, max: number, keyword?: string, sort?: string];
}>();

const keywords = ref("");
const fileSort = useLocalStorage(props.metadata ? "synctv:alist-sort" : "synctv:emby-sort", "original");
const selectedItems = ref<FileItem[]>([]);
const selectItem = (item: FileItem) => {
  selectedItems.value.push(item);
};

const findItem = (item: FileItem) => {
  return selectedItems.value.find((i) => i.path === item.path);
};

const removeItem = (item: FileItem) => {
  const i = selectedItems.value.findIndex((i) => i.path === item.path);
  selectedItems.value.splice(i, 1);
};

const removeAll = () => {
  selectedItems.value = [];
};

const setProxy = (item: FileItem) => {
  const i = selectedItems.value.findIndex((i) => i.path === item.path);
  selectedItems.value[i].isProxy = !selectedItems.value[i].isProxy;
};

const isSelect = (item: FileItem) => {
  return findItem(item)
    ? "bg-gray-200 hover:shadow-none hover:bg-slate-300 hover:scale-100 dark:bg-neutral-900 dark:hover:bg-stone-800"
    : "bg-slate-50 hover:shadow-md hover:bg-slate-100 hover:scale-[1.02] dark:bg-neutral-700 dark:hover:bg-neutral-600";
};

const currentPage = ref(1);
const pageSize = ref(10);

const selectOrToDir = (item: FileItem, select?: boolean) => {
  if (item.isDir && !select) {
    toDir(item.path, true, true);
  } else {
    findItem(item) ? removeItem(item) : selectItem(item);
  }
};

const toDir = (path: string, resetPage: boolean, resetKeywords: boolean) => {
  console.log("toDir", path);
  if (resetPage) {
    currentPage.value = 1;
    pageSize.value = 10;
  }
  if (resetKeywords) {
    keywords.value = "";
  }
  if (keywords.value && fileSort.value.startsWith("modified-")) fileSort.value = "name-asc";
  emit("toDir", path, currentPage.value, pageSize.value, keywords.value, fileSort.value);
};

const refresh = (resetPage: boolean, resetKeywords: boolean) => {
  toDir(props.fileList?.paths.findLast((i) => i)?.path || "", resetPage, resetKeywords);
};

defineExpose({
  selectedItems,
  removeAll,
  refresh,
  setProxy,
  findItem
});
</script>
<template>
  <el-breadcrumb class="-mt-5 mb-2" :separator-icon="ArrowRight">
    <el-breadcrumb-item v-for="(item, i) in props.fileList?.paths" :key="i">
      <template #default>
        <b class="cursor-pointer" @click="toDir(item.path, true, true)">{{
          item.name || (i === 0 ? "🏠主页" : undefined)
        }}</b>
      </template>
    </el-breadcrumb-item>
  </el-breadcrumb>
  <div class="my-2 flex items-center gap-2">
  <el-input
    class="min-w-0 flex-1"
    v-if="enableSearch"
    v-model="keywords"
    placeholder="搜索"
    @keyup.enter="refresh(true, false)"
    :disabled="isLoading"
  >
    <template #append>
      <el-button :icon="Search" :disabled="isLoading" @click="refresh(true, false)" />
    </template>
  </el-input>
  <SortSelector label="文件排序" v-model="fileSort" @change="refresh(true, false)" :metadata="metadata" :modified-disabled="!!keywords" :disabled="isLoading" />
  </div>
  <div v-loading="!fileList || isLoading">
    <div class="flex px-1 py-1">
      <p class="mr-auto">名称</p>
      <slot name="field"></slot>
      <p class="text-center mr-4 hidden xl:block">类型</p>
    </div>
    <div
      :class="
        'flex items-center p-2 my-2 rounded-md cursor-pointer transition-all duration-300 shadow-slate-300 ' +
        isSelect(item)
      "
      v-for="(item, i) in fileList?.items"
      :key="i"
      @click="selectOrToDir(item, true)"
    >
      <div
        class="truncate overflow-hidden mr-auto max-w-[70%] xl:max-w-[40%] 2xl:max-w-[50%] flex items-center"
      >
        <div v-if="item.isDir" class="flex items-center">
          <el-icon class="mr-2">
            <Folder />
          </el-icon>
          <p class="hover:underline" @click.stop="selectOrToDir(item)">
            {{ item.name }}
          </p>
        </div>

        <div v-else class="flex items-center">
          <el-icon class="mr-2"><Document /></el-icon>
          <p @click.stop="selectOrToDir(item)">{{ item.name }}</p>
        </div>
      </div>
      <slot name="item" :item="item"></slot>
    </div>
  </div>
  <div v-if="selectedItems.length > 0" class="flex justify-between items-center flex-wrap gap-3">
    <p>已选择：{{ selectedItems.length }} 个项目</p>
    <el-popconfirm
      confirm-button-text="是"
      cancel-button-text="否"
      title="你确定要清空已选中的吗？!"
      @confirm="removeAll"
    >
      <template #reference>
        <a href="javascript:;">清空选中</a>
      </template>
    </el-popconfirm>
  </div>
  <div class="flex justify-between items-center flex-wrap gap-3 mt-2 -mb-2">
    <el-pagination
      v-if="fileList"
      class="flex-wrap gap-3"
      v-model:current-page="currentPage"
      v-model:page-size="pageSize"
      :pager-count="5"
      layout="sizes, prev, pager, next, jumper"
      :total="fileList?.total"
      @size-change="toDir(fileList!.paths.findLast((i) => i)?.path || '', false, false)"
      @current-change="toDir(fileList!.paths.findLast((i) => i)?.path || '', false, false)"
    />
    <slot name="footer"> </slot>
  </div>
</template>
