<script setup lang="ts">
import { ref, computed } from 'vue';
import { useVirtualizer } from '@tanstack/vue-virtual';
import type { Order } from '@portal/users/utils';

interface OrdersCardProps {
  orders: Order[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

const props = defineProps<OrdersCardProps>();

const ROW_HEIGHT = 52;
const VISIBLE_ROWS = 8;

const scrollRef = ref<HTMLElement | null>(null);

// vue-virtual's useVirtualizer takes a reactive (computed) options object and
// returns a Ref<Virtualizer> — the CdkVirtualScrollViewport / @tanstack/react-virtual equivalent.
const virtualizer = useVirtualizer(
  computed(() => ({
    count: props.orders.length,
    getScrollElement: () => scrollRef.value,
    estimateSize: () => ROW_HEIGHT,
    overscan: 3,
  })),
);

const virtualRows = computed(() => virtualizer.value.getVirtualItems());
const totalSize = computed(() => virtualizer.value.getTotalSize());
const containerHeight = computed(
  () => Math.min(props.orders.length, VISIBLE_ROWS) * ROW_HEIGHT,
);
</script>

<template>
  <div class="card">
    <h2 class="heading">Orders</h2>

    <p v-if="error" class="error">{{ error }}</p>
    <p v-else-if="loading" class="muted">Loading orders...</p>

    <div
      v-else-if="orders.length > 0"
      ref="scrollRef"
      class="list"
      :style="{ height: `${containerHeight}px`, overflowY: 'auto' }"
      role="list"
      aria-label="Orders"
    >
      <div :style="{ height: `${totalSize}px`, position: 'relative' }">
        <div
          v-for="row in virtualRows"
          :key="row.index"
          class="row-wrap"
          :style="{ transform: `translateY(${row.start}px)` }"
        >
          <div class="row" role="listitem">
            <span>#{{ orders[row.index].id }}</span>
            <strong>{{ orders[row.index].total.toFixed(2) }}</strong>
          </div>
        </div>
      </div>
    </div>

    <p v-else-if="loaded" class="muted">No orders for this user.</p>
  </div>
</template>

<style scoped>
.card {
  padding: 1rem;
  border: 1px solid #d8dbe2;
  border-radius: 12px;
  background: #fff;
}
.heading {
  margin: 0 0 0.75rem;
}
.list {
  border: 1px solid #eef2f6;
  border-radius: 8px;
}
.row-wrap {
  position: absolute;
  top: 0;
  width: 100%;
}
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 10px;
  border-bottom: 1px solid #eef2f6;
  box-sizing: border-box;
}
.muted {
  color: #667085;
  margin: 0;
}
.error {
  color: #dc2626;
  margin: 0;
}
</style>