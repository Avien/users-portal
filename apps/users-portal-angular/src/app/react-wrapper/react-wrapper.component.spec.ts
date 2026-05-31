import { TestBed } from '@angular/core/testing';
import { loadRemote } from '@module-federation/runtime';
import { ReactWrapperComponent } from './react-wrapper.component';

jest.mock('@module-federation/runtime', () => ({
  loadRemote: jest.fn(),
}));

describe('ReactWrapperComponent', () => {
  const mockUnmount = jest.fn();
  const mockMount = jest.fn().mockReturnValue(mockUnmount);

  beforeEach(async () => {
    jest.clearAllMocks();
    (loadRemote as jest.Mock).mockResolvedValue({ mount: mockMount });

    await TestBed.configureTestingModule({
      imports: [ReactWrapperComponent],
    }).compileComponents();
  });

  it('should create the component', () => {
    const fixture = TestBed.createComponent(ReactWrapperComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('loads react-users/mount remote on init', async () => {
    const fixture = TestBed.createComponent(ReactWrapperComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(loadRemote).toHaveBeenCalledWith('react-users/mount');
  });

  it('calls mount with the host element and initialPath /users', async () => {
    const fixture = TestBed.createComponent(ReactWrapperComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(mockMount).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      { initialPath: '/users' }
    );
  });

  it('calls the unmount function on component destroy', async () => {
    const fixture = TestBed.createComponent(ReactWrapperComponent);
    fixture.detectChanges();
    await fixture.whenStable();

    fixture.destroy();

    expect(mockUnmount).toHaveBeenCalledTimes(1);
  });
});