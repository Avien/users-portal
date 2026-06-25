<script setup lang="ts">
import { ref, onErrorCaptured } from 'vue';

// Vue's equivalent of React's ErrorBoundary class component: onErrorCaptured
// catches errors thrown by descendants during render/lifecycle.
const error = ref<Error | null>(null);

onErrorCaptured((err) => {
  error.value = err instanceof Error ? err : new Error(String(err));
  console.error('[ErrorBoundary]', error.value);
  return false; // stop the error from propagating further
});
</script>

<template>
  <slot v-if="!error" />
  <slot v-else name="fallback" :error="error">
    <div class="container">
      <h2 class="heading">Something went wrong</h2>
      <pre class="message">{{ error.message }}</pre>
    </div>
  </slot>
</template>

<style scoped>
.container {
  max-width: 600px;
  margin: 2rem auto;
  padding: 1.5rem;
  border: 1px solid #fca5a5;
  border-radius: 8px;
  background: #fef2f2;
  color: #dc2626;
}
.heading {
  margin: 0 0 0.5rem;
}
.message {
  margin: 0;
  font-size: 0.875rem;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>