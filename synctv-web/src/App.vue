<script setup lang="ts">
import Header from "./components/Header.vue";
import { RouterView } from "vue-router";
</script>

<template>
  <Header />
  <el-container>
    <el-main>
      <RouterView :key="$route.path" />
    </el-main>
  </el-container>
</template>
