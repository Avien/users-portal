import { ChangeDetectionStrategy, Component } from '@angular/core';
import { UserOrdersComponent } from '@portal/users-angular/feature';
import { BusinessAgentPanelComponent } from '@portal/business-agent-angular';

// Composition root for two independent capabilities (Users/Orders feature +
// Business Agent) — neither owns the other, matching the same split the React
// host uses in app.tsx. See docs/roadmap.md Phase 3.
//
// No shared shell styling needed here: <user-orders> and <business-agent-panel>
// each already own their own centered max-width:900px shell (unlike React, where
// that padding was factored out into the composition root instead) — this stays
// a plain vertical stack.
@Component({
  selector: 'app-users-page',
  standalone: true,
  imports: [UserOrdersComponent, BusinessAgentPanelComponent],
  template: `
    <user-orders />
    <business-agent-panel />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class UsersPageComponent {}
