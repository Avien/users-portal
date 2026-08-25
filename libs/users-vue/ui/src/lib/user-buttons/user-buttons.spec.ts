import { mount } from '@vue/test-utils';
import UserButtons from './user-buttons.vue';
import { MOCK_USERS } from '@portal/users/utils';

const base = { unseenOrderCounts: {} };

describe('UserButtons', () => {
  it('renders a button per user and marks the selected one active', () => {
    const wrapper = mount(UserButtons, {
      props: { ...base, users: MOCK_USERS, selectedUserId: MOCK_USERS[0].id },
    });
    const buttons = wrapper.findAll('button');
    expect(buttons).toHaveLength(MOCK_USERS.length);
    expect(buttons[0].classes()).toContain('active');
    expect(buttons[1].classes()).not.toContain('active');
  });

  it('emits select with the user id on click', async () => {
    const wrapper = mount(UserButtons, {
      props: { ...base, users: MOCK_USERS, selectedUserId: null },
    });
    await wrapper.findAll('button')[1].trigger('click');
    expect(wrapper.emitted('select')?.[0]).toEqual([MOCK_USERS[1].id]);
  });

  describe('live order feedback', () => {
    it('shows no badge when there is no unseen count', () => {
      const wrapper = mount(UserButtons, {
        props: { users: MOCK_USERS, selectedUserId: MOCK_USERS[0].id, unseenOrderCounts: {} },
      });
      expect(wrapper.find('.badge').exists()).toBe(false);
    });

    it('shows a "+N" badge on an unselected user with unseen orders', () => {
      const wrapper = mount(UserButtons, {
        props: {
          users: MOCK_USERS,
          selectedUserId: MOCK_USERS[0].id,
          unseenOrderCounts: { [MOCK_USERS[1].id]: 3 },
        },
      });
      expect(wrapper.find('.badge').text()).toBe('+3');
    });

    it('never shows a badge for the currently-selected user, even with a nonzero count', () => {
      const wrapper = mount(UserButtons, {
        props: {
          users: MOCK_USERS,
          selectedUserId: MOCK_USERS[1].id,
          unseenOrderCounts: { [MOCK_USERS[1].id]: 5 },
        },
      });
      expect(wrapper.find('.badge').exists()).toBe(false);
    });

    it('exposes the unseen count via aria-label, not color alone', () => {
      const wrapper = mount(UserButtons, {
        props: {
          users: MOCK_USERS,
          selectedUserId: MOCK_USERS[0].id,
          unseenOrderCounts: { [MOCK_USERS[1].id]: 1 },
        },
      });
      expect(wrapper.findAll('button')[1].attributes('aria-label')).toBe(
        `${MOCK_USERS[1].name}, 1 new order`,
      );
    });

    it('pluralizes the aria-label for counts greater than one', () => {
      const wrapper = mount(UserButtons, {
        props: {
          users: MOCK_USERS,
          selectedUserId: MOCK_USERS[0].id,
          unseenOrderCounts: { [MOCK_USERS[1].id]: 2 },
        },
      });
      expect(wrapper.findAll('button')[1].attributes('aria-label')).toBe(
        `${MOCK_USERS[1].name}, 2 new orders`,
      );
    });

    it('does not disturb button semantics/aria-label when there is nothing unseen', () => {
      const wrapper = mount(UserButtons, {
        props: { ...base, users: MOCK_USERS, selectedUserId: MOCK_USERS[0].id },
      });
      expect(wrapper.findAll('button')[1].attributes('aria-label')).toBeUndefined();
    });
  });
});