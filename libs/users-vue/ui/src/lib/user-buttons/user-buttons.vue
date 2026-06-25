<script setup lang="ts">
import type { User } from '@portal/users/utils';

interface UserButtonsProps {
  users: User[];
  selectedUserId: number | null;
}

defineProps<UserButtonsProps>();
const emit = defineEmits<{ (e: 'select', id: number): void }>();
</script>

<template>
  <div class="actions">
    <button
      v-for="user in users"
      :key="user.id"
      type="button"
      :class="['btn', { active: user.id === selectedUserId }]"
      @click="emit('select', user.id)"
    >
      {{ user.name }}
    </button>
  </div>
</template>

<style scoped>
.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}
.btn {
  border: 1px solid #cbd5e1;
  background: #fff;
  border-radius: 999px;
  padding: 0.65rem 1rem;
  cursor: pointer;
  font-size: inherit;
}
.btn.active {
  border-color: #0f172a;
  background: #e2e8f0;
}
</style>