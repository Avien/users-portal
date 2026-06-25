import { mount } from '@vue/test-utils';
import OrdersCard from './orders-card.vue';
import { MOCK_ORDERS } from '@portal/users/utils';

const base = { orders: [], loading: false, loaded: false, error: null };

describe('OrdersCard', () => {
  it('shows the error message when error is set', () => {
    const wrapper = mount(OrdersCard, { props: { ...base, error: 'Network failed' } });
    expect(wrapper.find('.error').text()).toBe('Network failed');
  });

  it('shows a loading message while loading', () => {
    const wrapper = mount(OrdersCard, { props: { ...base, loading: true } });
    expect(wrapper.find('.muted').text()).toContain('Loading');
  });

  it('shows the empty state when loaded with no orders', () => {
    const wrapper = mount(OrdersCard, { props: { ...base, loaded: true } });
    expect(wrapper.find('.muted').text()).toContain('No orders');
  });

  it('renders the scrollable orders list when orders exist', () => {
    const wrapper = mount(OrdersCard, {
      props: { ...base, orders: MOCK_ORDERS.slice(0, 3), loaded: true },
    });
    expect(wrapper.find('[role="list"]').exists()).toBe(true);
  });
});