import { mount } from '@vue/test-utils';
import UserTotalOrders from './user-total-orders.vue';

describe('UserTotalOrders', () => {
  it('renders the total formatted to two decimals', () => {
    const wrapper = mount(UserTotalOrders, { props: { totalAmount: 1234.5 } });
    expect(wrapper.text()).toContain('$1234.50');
  });
});