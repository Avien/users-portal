<!--
  Composition root for two independent capabilities (Users/Orders feature +
  Business Agent) — neither owns the other, matching the same split the React
  host uses in app.tsx. See docs/roadmap.md Phase 3.
-->
<script setup lang="ts">
import { UserOrders } from '@portal/users-vue/feature';
import { BusinessAgentPanel } from '@portal/business-agent-vue';
</script>

<template>
  <UserOrders />
  <BusinessAgentPanel />
</template>
