<script setup lang="ts">
import type { User } from '@portal/users/utils';

interface UserButtonsProps {
  users: User[];
  selectedUserId: number | null;
  unseenOrderCounts: Readonly<Record<number, number>>;
}

const props = defineProps<UserButtonsProps>();
const emit = defineEmits<{ (e: 'select', id: number): void }>();

function unseenCountFor(userId: number): number {
  return props.unseenOrderCounts[userId] ?? 0;
}

function ariaLabelFor(user: User): string | undefined {
  if (user.id === props.selectedUserId) return undefined;
  const count = unseenCountFor(user.id);
  if (count === 0) return undefined;
  return `${user.name}, ${count} new order${count === 1 ? '' : 's'}`;
}
</script>

<template>
  <div class="actions">
    <button
      v-for="user in users"
      :key="user.id"
      type="button"
      class="btn"
      :class="{ active: user.id === selectedUserId }"
      :aria-label="ariaLabelFor(user)"
      @click="emit('select', user.id)"
    >
      {{ user.name }}
      <span
        v-if="user.id !== selectedUserId && unseenCountFor(user.id) > 0"
        class="badge"
        aria-hidden="true"
      >+{{ unseenCountFor(user.id) }}</span>
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
  position: relative;
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

/* Live WebSocket order visual feedback (Post-production / Portfolio Polish,
   see docs/roadmap.md) — "+N" badge for orders that arrived over WS while a
   user's tab was not selected. Ephemeral UI state only. */
.badge {
  position: absolute;
  top: -8px;
  right: -8px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 999px;
  background: #0f766e;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  line-height: 18px;
  text-align: center;
  box-shadow: 0 0 0 2px #fff;
}
</style>