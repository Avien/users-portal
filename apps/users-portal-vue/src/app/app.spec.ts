import { mount } from '@vue/test-utils';
import App from './App.vue';

describe('App', () => {
  it('renders the portal heading', () => {
    const wrapper = mount(App);
    expect(wrapper.text()).toContain('Users Portal');
  });
});