import { mount } from '@vue/test-utils';
import UserName from './user-name.vue';

describe('UserName', () => {
  it('renders the selected user name', () => {
    const wrapper = mount(UserName, { props: { userName: 'Alice Johnson' } });
    expect(wrapper.text()).toContain('Selected user');
    expect(wrapper.text()).toContain('Alice Johnson');
  });
});