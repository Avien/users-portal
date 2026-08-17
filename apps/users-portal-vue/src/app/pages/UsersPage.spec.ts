import { mount } from '@vue/test-utils';
import { h } from 'vue';
import UsersPage from './UsersPage.vue';

// This only proves the app-level composition (both capabilities present on the
// same page) — not UserOrders' own behavior, already covered where UserOrders
// itself lives, and not the widget's own behavior, already covered in
// libs/business-agent-widget.
vi.mock('@portal/users-vue/feature', () => ({
  UserOrders: { name: 'UserOrders', setup: () => () => h('div', { 'data-testid': 'user-orders' }) },
}));

describe('UsersPage — Users/Orders + Business Agent composition', () => {
  it('renders both the Users/Orders feature and the Business Agent widget', () => {
    const wrapper = mount(UsersPage);
    expect(wrapper.find('[data-testid="user-orders"]').exists()).toBe(true);
    expect(wrapper.find('business-agent-widget').exists()).toBe(true);
  });
});
