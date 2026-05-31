import { describe, it, expect, vi, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { mount } from './mount';

vi.mock('./app/app', () => ({
  default: () => <div data-testid="app" />,
}));

describe('mount', () => {
  let container: HTMLDivElement;

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('renders React app into the container', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);

    await act(async () => { mount(container, { initialPath: '/users' }); });

    expect(container.querySelector('[data-testid="app"]')).toBeTruthy();
  });

  it('returns an unmount function that clears the React tree', async () => {
    container = document.createElement('div');
    document.body.appendChild(container);

    let unmount!: () => void;
    await act(async () => { unmount = mount(container, { initialPath: '/users' }); });
    expect(container.querySelector('[data-testid="app"]')).toBeTruthy();

    act(() => { unmount(); });
    expect(container.querySelector('[data-testid="app"]')).toBeNull();
  });
});