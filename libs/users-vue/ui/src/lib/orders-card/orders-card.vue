<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue';
import { useVirtualizer } from '@tanstack/vue-virtual';
import type { Order } from '@portal/users/utils';

interface OrdersCardProps {
  orders: Order[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  recentlyArrivedOrderIds: ReadonlySet<number>;
  // Purely so this component can tell "the selected user changed" apart from
  // "more of the same user's orders arrived", to reset its own live-follow /
  // pending-scroll state on switch — not used for anything else.
  selectedUserId: number | null;
}

const props = defineProps<OrdersCardProps>();

const ROW_HEIGHT = 52;
const VISIBLE_ROWS = 8;
const VIEWPORT_HEIGHT_PX = VISIBLE_ROWS * ROW_HEIGHT;
// "Reasonably near the bottom" for live-follow purposes — about one row's
// worth of scroll distance from the true bottom.
const NEAR_BOTTOM_THRESHOLD_PX = ROW_HEIGHT;

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

// Smart live-follow (Post-production / Portfolio Polish, see
// docs/roadmap.md) — ephemeral UI/virtual-list-layer scroll state only; not
// shared/domain state, and not a new WS subscription. Driven entirely by
// recentlyArrivedOrderIds, which is already the source of truth for "this
// was a genuine WS arrival for the currently-selected user."
const liveFollow = ref(true);
const pendingCount = ref(0);

async function scrollToLatest(): Promise<void> {
  if (props.orders.length === 0) return;
  // Wait for the next DOM update so the new row already exists in the
  // virtualizer's count before asking it to scroll there — no arbitrary
  // setTimeout needed.
  await nextTick();
  virtualizer.value.scrollToIndex(props.orders.length - 1, { align: 'end', behavior: 'smooth' });
}

// Vue's multi-source watch hands both new AND previous values in one
// callback — no manual ref-diffing needed, and (without `immediate: true`)
// it never fires on initial mount, so the first-ever recentlyArrivedOrderIds
// value is never mistaken for a batch of brand-new arrivals.
watch(
  [() => props.selectedUserId, () => props.recentlyArrivedOrderIds],
  ([userId, arrived], [previousUserId, previousArrived]) => {
    // A different user entirely — start fresh rather than carrying over
    // scroll/pending state from whoever was selected before.
    if (userId !== previousUserId) {
      liveFollow.value = true;
      pendingCount.value = 0;
      return;
    }

    const newlyArrivedCount = [...arrived].filter((id) => !previousArrived.has(id)).length;
    if (newlyArrivedCount === 0) return;

    if (liveFollow.value) {
      scrollToLatest();
    } else {
      pendingCount.value += newlyArrivedCount;
    }
  },
);

// "Do not fight the user" — stop auto-scrolling once they scroll away from
// the bottom to inspect older orders, and resume (clearing the pending
// indicator) once they scroll back near it.
function handleScroll(): void {
  const el = scrollRef.value;
  if (!el) return;
  const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
  const nearBottom = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX;
  liveFollow.value = nearBottom;
  if (nearBottom) pendingCount.value = 0;
}

function resumeLiveFollow(): void {
  liveFollow.value = true;
  pendingCount.value = 0;
  scrollToLatest();
}
</script>

<template>
  <div class="card">
    <div class="header-row">
      <h2 class="heading">Orders</h2>
      <button
        v-if="!liveFollow && pendingCount > 0"
        type="button"
        class="new-orders-indicator"
        @click="resumeLiveFollow"
      >
        +{{ pendingCount }} new order{{ pendingCount === 1 ? '' : 's' }} ↓
      </button>
    </div>

    <div class="viewport" data-testid="orders-viewport" :style="{ height: `${VIEWPORT_HEIGHT_PX}px` }">
      <p v-if="error" class="error">{{ error }}</p>
      <p v-else-if="loading" class="muted">Loading orders...</p>

      <div
        v-else-if="orders.length > 0"
        ref="scrollRef"
        class="list"
        role="list"
        aria-label="Orders"
        @scroll="handleScroll"
      >
        <div :style="{ height: `${totalSize}px`, position: 'relative' }">
          <div
            v-for="row in virtualRows"
            :key="row.index"
            class="row-wrap"
            :style="{ transform: `translateY(${row.start}px)` }"
          >
            <div
              class="row"
              :class="{ 'row--new': recentlyArrivedOrderIds.has(orders[row.index].id) }"
              role="listitem"
            >
              <span>#{{ orders[row.index].id }}</span>
              <strong>{{ orders[row.index].total.toFixed(2) }}</strong>
            </div>
          </div>
        </div>
      </div>

      <p v-else-if="loaded" class="muted">No orders for this user.</p>
    </div>
  </div>
</template>

<style scoped>
.card {
  padding: 1rem;
  border: 1px solid #d8dbe2;
  border-radius: 12px;
  background: #fff;
}
.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}
.heading {
  margin: 0;
}

/* Stable Orders viewport height (Post-production / Portfolio Polish, see
   docs/roadmap.md) — reserves the same vertical space as the normal
   virtualized viewport (VIEWPORT_HEIGHT_PX = VISIBLE_ROWS × ROW_HEIGHT)
   across every state — loading, switching users, empty, and the rendered
   list — so the Business Agent and everything below the Orders card never
   jumps vertically. */
.viewport {
  display: flex;
  flex-direction: column;
  justify-content: flex-start; /* top-aligns loading/empty/error text */
}
.list {
  height: 100%;
  overflow-y: auto;
  border: 1px solid #eef2f6;
  border-radius: 8px;
  box-sizing: border-box;
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

/* Smart live-follow "paused" indicator — clicking it scrolls to the latest
   row, clears the pending count, and resumes live-follow. */
.new-orders-indicator {
  border: none;
  border-radius: 999px;
  padding: 0.3rem 0.75rem;
  background: #0f766e;
  color: #fff;
  font-size: 0.8rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.new-orders-indicator:hover {
  background: #0b5a54;
}

/* Live WebSocket order visual feedback (Post-production / Portfolio Polish,
   see docs/roadmap.md) — a subtle, temporary highlight on a newly-arrived
   order row. Ephemeral presentation only; driven by a prop, not by any field
   on the Order model or the WS wire contract. */
@media (prefers-reduced-motion: no-preference) {
  .row--new {
    animation: order-row-pulse 2.5s ease-out;
  }
}
@media (prefers-reduced-motion: reduce) {
  .row--new {
    background-color: rgba(250, 204, 21, 0.18);
  }
}
@keyframes order-row-pulse {
  0% {
    background-color: rgba(250, 204, 21, 0.4);
  }
  100% {
    background-color: transparent;
  }
}
</style>
