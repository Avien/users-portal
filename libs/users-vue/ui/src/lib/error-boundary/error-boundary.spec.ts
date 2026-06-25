import { mount } from '@vue/test-utils';
import { defineComponent, h, nextTick } from 'vue';
import ErrorBoundary from './error-boundary.vue';

const Boom = defineComponent({
  setup() {
    throw new Error('kaboom');
  },
});

describe('ErrorBoundary', () => {
  it('renders the default slot when there is no error', () => {
    const wrapper = mount(ErrorBoundary, { slots: { default: '<p>all good</p>' } });
    expect(wrapper.html()).toContain('all good');
  });

  it('renders the fallback when a descendant throws', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const wrapper = mount(ErrorBoundary, { slots: { default: () => h(Boom) } });
    await nextTick(); // onErrorCaptured sets the error ref → re-render is async
    expect(wrapper.text()).toContain('Something went wrong');
    expect(wrapper.text()).toContain('kaboom');
    spy.mockRestore();
  });
});