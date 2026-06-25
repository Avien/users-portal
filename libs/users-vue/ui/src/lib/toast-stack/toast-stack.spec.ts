import { mount } from '@vue/test-utils';
import ToastStack from './toast-stack.vue';
import type { Notification } from '@portal/users/utils';

const notifications: Notification[] = [
  { id: 'a', severity: 'warning', message: 'High-value order', timestamp: 1 },
  { id: 'b', severity: 'critical', message: 'Order burst', timestamp: 2 },
];

describe('ToastStack', () => {
  it('renders a toast per notification with its severity class', () => {
    const wrapper = mount(ToastStack, { props: { notifications } });
    const toasts = wrapper.findAll('.toast');
    expect(toasts).toHaveLength(2);
    expect(toasts[0].classes()).toContain('warning');
    expect(toasts[1].classes()).toContain('critical');
  });

  it('emits dismiss with the notification id when close is clicked', async () => {
    const wrapper = mount(ToastStack, { props: { notifications } });
    await wrapper.findAll('.close')[0].trigger('click');
    expect(wrapper.emitted('dismiss')?.[0]).toEqual(['a']);
  });
});