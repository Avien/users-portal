<script setup lang="ts">
import { computed } from 'vue';
import { useUsersFacade } from '../use-users-facade';
import {
  UserButtons,
  UserName,
  UserTotalOrders,
  OrdersCard,
  ToastStack,
} from '@portal/users-vue/ui';

// Smart container: calls the facade and lays out the dumb ui components.
// Destructuring is safe — every field is a ComputedRef, so it stays reactive.
const {
  users,
  loading,
  loaded,
  error,
  selectedUserId,
  selectedUserSummary,
  orders,
  notifications,
  selectUser,
  dismissOrderNotification,
  recentlyArrivedOrderIds,
  unseenOrderCountsByUserId,
} = useUsersFacade();

const ordersLoading = computed(() => loading.value && selectedUserId.value !== null);
</script>

<template>
  <ToastStack :notifications="notifications" @dismiss="dismissOrderNotification" />

  <section class="shell">
    <header class="page-header">
      <h1 class="title">Users orders dashboard</h1>
      <div class="subtitle-row">
        <p class="subtitle">Facade-driven example with TanStack Query and Vue.</p>
        <span class="spinner" :class="{ hidden: !loading }" aria-label="Loading" />
      </div>
    </header>

    <p v-if="error" class="error">{{ error }}</p>

    <UserButtons
      :users="users"
      :selected-user-id="selectedUserId"
      :unseen-order-counts="unseenOrderCountsByUserId"
      @select="selectUser"
    />

    <template v-if="selectedUserSummary">
      <div class="summary-grid">
        <UserName :user-name="selectedUserSummary.userName" />
        <UserTotalOrders :total-amount="selectedUserSummary.totalAmount" />
      </div>
      <OrdersCard
        :orders="orders"
        :loading="ordersLoading"
        :loaded="loaded"
        :error="error"
        :recently-arrived-order-ids="recentlyArrivedOrderIds"
        :selected-user-id="selectedUserId"
      />
    </template>
    <p v-else-if="!loading && loaded" class="empty">Select a user</p>
  </section>
</template>

<style scoped>
.shell {
  max-width: 900px;
  margin: 0 auto;
  padding: 2rem;
}
.page-header {
  margin-bottom: 1.5rem;
}
.title {
  margin: 0 0 0.5rem;
}
.subtitle-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.subtitle {
  margin: 0;
  color: #667085;
}
.summary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1rem;
  margin-bottom: 1.5rem;
}
.error {
  color: #dc2626;
}
.empty {
  padding: 1rem;
  color: #667085;
}
.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid #cbd5e1;
  border-top-color: #0f172a;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.spinner.hidden {
  visibility: hidden;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>