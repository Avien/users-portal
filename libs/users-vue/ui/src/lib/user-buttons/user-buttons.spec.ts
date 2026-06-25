import { mount } from '@vue/test-utils';
import UserButtons from './user-buttons.vue';
import { MOCK_USERS } from '@portal/users/utils';

describe('UserButtons', () => {
  it('renders a button per user and marks the selected one active', () => {
    const wrapper = mount(UserButtons, {
      props: { users: MOCK_USERS, selectedUserId: MOCK_USERS[0].id },
    });
    const buttons = wrapper.findAll('button');
    expect(buttons).toHaveLength(MOCK_USERS.length);
    expect(buttons[0].classes()).toContain('active');
    expect(buttons[1].classes()).not.toContain('active');
  });

  it('emits select with the user id on click', async () => {
    const wrapper = mount(UserButtons, {
      props: { users: MOCK_USERS, selectedUserId: null },
    });
    await wrapper.findAll('button')[1].trigger('click');
    expect(wrapper.emitted('select')?.[0]).toEqual([MOCK_USERS[1].id]);
  });
});