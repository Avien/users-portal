<script setup lang="ts">
interface UserTotalOrdersProps {
  totalAmount: number;
}

defineProps<UserTotalOrdersProps>();
</script>

<template>
  <div class="card">
    <span class="label">Total orders</span>
    <strong class="value">${{ totalAmount.toFixed(2) }}</strong>
  </div>
</template>

<style scoped>
.card {
  padding: 1rem;
  border: 1px solid #d8dbe2;
  border-radius: 12px;
  background: #fff;
}
.label {
  display: block;
  margin-bottom: 0.35rem;
  font-size: 0.85rem;
  color: #667085;
}
.value {
  font-size: 1.1rem;
}
</style>