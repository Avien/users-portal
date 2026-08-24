<script setup lang="ts">
import { RouterView } from 'vue-router';
import { useOrdersStream } from '@portal/users-vue/data-access';
// App-shell infrastructure, not Users/Orders domain UI — kept app-local rather
// than in @portal/users-vue/ui (a type:app project may not depend on type:ui;
// this has no domain knowledge and only App itself ever uses it).
import ErrorBoundary from './error-boundary/error-boundary.vue';

// Infrastructure side-effect — opened once at the app root (the WebSocket
// singleton), never inside a route-bound component.
useOrdersStream();
</script>

<template>
  <ErrorBoundary>
    <RouterView />
  </ErrorBoundary>
</template>