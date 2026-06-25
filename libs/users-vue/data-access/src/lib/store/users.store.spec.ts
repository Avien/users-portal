import { setActivePinia, createPinia } from 'pinia';
import { useUsersStore } from './users.store';

describe('useUsersStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('adds a notification with a generated id and timestamp', () => {
    const store = useUsersStore();
    store.addNotification({ severity: 'warning', message: 'High-value order' });
    expect(store.notifications).toHaveLength(1);
    expect(store.notifications[0].id).toBeTruthy();
    expect(store.notifications[0].timestamp).toBeTypeOf('number');
  });

  it('auto-dismisses a warning after 10s and a critical after 20s', () => {
    const store = useUsersStore();
    store.addNotification({ severity: 'warning', message: 'w' });
    store.addNotification({ severity: 'critical', message: 'c' });
    vi.advanceTimersByTime(10_000);
    expect(store.notifications.map((n) => n.severity)).toEqual(['critical']);
    vi.advanceTimersByTime(10_000);
    expect(store.notifications).toHaveLength(0);
  });

  it('dismisses by id and clears its timer', () => {
    const store = useUsersStore();
    store.addNotification({ severity: 'critical', message: 'x' });
    const { id } = store.notifications[0];
    store.dismissNotification(id);
    expect(store.notifications).toHaveLength(0);
  });
});