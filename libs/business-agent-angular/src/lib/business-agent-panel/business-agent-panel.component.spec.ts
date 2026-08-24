import { TestBed } from '@angular/core/testing';
import { BusinessAgentPanelComponent, BUSINESS_AGENT_ENDPOINT } from './business-agent-panel.component';

function render(endpoint?: string) {
  TestBed.configureTestingModule({
    imports: [BusinessAgentPanelComponent],
    providers: endpoint !== undefined ? [{ provide: BUSINESS_AGENT_ENDPOINT, useValue: endpoint }] : []
  });
  const fixture = TestBed.createComponent(BusinessAgentPanelComponent);
  fixture.detectChanges();
  return fixture;
}

describe('BusinessAgentPanelComponent', () => {
  it('renders the shared business-agent-widget custom element', () => {
    const fixture = render();
    expect(fixture.nativeElement.querySelector('business-agent-widget')).toBeTruthy();
  });

  it('does not set an endpoint attribute when BUSINESS_AGENT_ENDPOINT is not provided', () => {
    const fixture = render();
    const widget = fixture.nativeElement.querySelector('business-agent-widget');
    expect(widget.hasAttribute('endpoint')).toBe(false);
  });

  it('wires the endpoint from the provided BUSINESS_AGENT_ENDPOINT token', () => {
    const fixture = render('http://localhost:8787/api/business-agent');
    const widget = fixture.nativeElement.querySelector('business-agent-widget');
    expect(widget.getAttribute('endpoint')).toBe('http://localhost:8787/api/business-agent');
  });
});
