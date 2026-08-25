import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { User } from '@portal/users/utils';
import { UserButtonsComponent } from './user-buttons.component';

const USERS: User[] = [
  { id: 1, name: 'Avi Cohen' },
  { id: 2, name: 'Dana Levi' }
];

describe('UserButtonsComponent', () => {
  let fixture: ComponentFixture<UserButtonsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserButtonsComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(UserButtonsComponent);
    fixture.componentRef.setInput('users', USERS);
  });

  function buttons(): HTMLButtonElement[] {
    return fixture.debugElement.queryAll(By.css('.user-button')).map((el) => el.nativeElement as HTMLButtonElement);
  }

  it('renders one button per user with no badge by default', () => {
    fixture.detectChanges();
    const els = buttons();
    expect(els).toHaveLength(2);
    for (const el of els) {
      expect(el.querySelector('.unseen-badge')).toBeNull();
      expect(el.getAttribute('aria-label')).toBeNull();
    }
  });

  it('shows a "+N" badge on an unselected user with unseen orders', () => {
    fixture.componentRef.setInput('selectedUserId', 1);
    fixture.componentRef.setInput('unseenOrderCounts', { 2: 3 });
    fixture.detectChanges();

    const danaButton = buttons()[1];
    const badge = danaButton.querySelector('.unseen-badge');
    expect(badge?.textContent).toBe('+3');
  });

  it('does not rely on color alone — the badge always carries a visible "+N" text', () => {
    fixture.componentRef.setInput('selectedUserId', 1);
    fixture.componentRef.setInput('unseenOrderCounts', { 2: 1 });
    fixture.detectChanges();

    const badge = buttons()[1].querySelector('.unseen-badge');
    expect(badge?.textContent).toMatch(/^\+\d+$/);
  });

  it('never shows a badge for the currently selected user, even if it has an unseen count', () => {
    fixture.componentRef.setInput('selectedUserId', 1);
    fixture.componentRef.setInput('unseenOrderCounts', { 1: 5, 2: 0 });
    fixture.detectChanges();

    const [aviButton, danaButton] = buttons();
    expect(aviButton.querySelector('.unseen-badge')).toBeNull();
    expect(danaButton.querySelector('.unseen-badge')).toBeNull(); // count is 0
  });

  it('exposes the unseen count to assistive tech via the button\'s accessible name, not the badge alone', () => {
    fixture.componentRef.setInput('selectedUserId', 1);
    fixture.componentRef.setInput('unseenOrderCounts', { 2: 2 });
    fixture.detectChanges();

    const danaButton = buttons()[1];
    expect(danaButton.getAttribute('aria-label')).toBe('Dana Levi, 2 new orders');
    // The visual badge itself is hidden from assistive tech to avoid a
    // double announcement — the button's own aria-label already covers it.
    expect(danaButton.querySelector('.unseen-badge')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('uses singular wording for exactly 1 unseen order', () => {
    fixture.componentRef.setInput('selectedUserId', 1);
    fixture.componentRef.setInput('unseenOrderCounts', { 2: 1 });
    fixture.detectChanges();

    expect(buttons()[1].getAttribute('aria-label')).toBe('Dana Levi, 1 new order');
  });

  it('keeps every button keyboard-focusable, type="button", and clickable exactly as before', () => {
    fixture.componentRef.setInput('selectedUserId', 1);
    fixture.componentRef.setInput('unseenOrderCounts', { 2: 4 });
    fixture.detectChanges();

    const danaButton = buttons()[1];
    expect(danaButton.getAttribute('type')).toBe('button');
    expect(danaButton.tabIndex).toBe(0);

    const emitted: number[] = [];
    fixture.componentInstance.userSelected.subscribe((id) => emitted.push(id));
    danaButton.click();
    expect(emitted).toEqual([2]);
  });

  it('defaults unseenOrderCounts to an empty record', () => {
    expect(fixture.componentInstance.unseenOrderCounts()).toEqual({});
  });
});
