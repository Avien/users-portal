<script setup lang="ts">
import { RouterView } from 'vue-router';
import { useOrdersStream } from '@portal/users-vue/data-access';
import { ErrorBoundary } from '@portal/users-vue/ui';

// Infrastructure side-effect — opened once at the app root (the WebSocket
// singleton), never inside a route-bound component.
useOrdersStream();
</script>

<template>
  <ErrorBoundary>
    <RouterView />
  </ErrorBoundary>
</template>