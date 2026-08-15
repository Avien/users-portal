import { describe, it, expect } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { MOCK_ORDERS, MOCK_USERS, SUSPICIOUS_ORDER_TOTAL_THRESHOLD } from '../libs/users/src/index.ts';
import { tools, runAgent } from './business-agent-server.ts';

// Phase 1 tests (see docs/roadmap.md — Product-Facing Business AI Agent).
// Unit-tests the 3 read-only business tools against the real mock data, plus one
// orchestration test proving the agent loop's tool_use -> tool execution -> tool_result
// -> final response wiring. The Claude API is never called — runAgent takes the
// Anthropic client as a parameter, so the orchestration test passes a fake one.

describe('business tools', () => {
  describe('searchUsers', () => {
    it('returns every user when no query is given', () => {
      const result = tools.searchUsers.run({});
      expect(result.users).toEqual(MOCK_USERS);
    });

    it('matches by case-insensitive substring', () => {
      const result = tools.searchUsers.run({ query: 'dana' });
      expect(result.users).toEqual([MOCK_USERS.find((u) => u.name === 'Dana Levi')]);
    });

    it('returns no matches for an unknown name', () => {
      const result = tools.searchUsers.run({ query: 'nobody' });
      expect(result.users).toEqual([]);
    });
  });

  describe('getUserOrders', () => {
    it('returns a known user\'s orders and total-spend summary', () => {
      const result = tools.getUserOrders.run({ userId: 2 });
      expect(result.orders).toEqual(MOCK_ORDERS.filter((o) => o.userId === 2));
      expect(result.summary).toEqual({ userName: 'Dana Levi', totalAmount: 220 + 18.75 });
    });

    it('returns an error for an unknown userId', () => {
      const result = tools.getUserOrders.run({ userId: 999 });
      expect(result).toEqual({ error: 'No user with id 999' });
    });
  });

  describe('getOrderMonitoringSignals', () => {
    it('flags orders at or above the shared high-value threshold', () => {
      const result = tools.getOrderMonitoringSignals.run({ userId: 3 });
      expect(result.threshold).toBe(SUSPICIOUS_ORDER_TOTAL_THRESHOLD);
      expect(result.highValueOrderCount).toBe(1);
      expect(result.highValueOrders).toEqual([MOCK_ORDERS.find((o) => o.id === 301)]);
    });

    it('reports zero high-value orders for a user with none', () => {
      const result = tools.getOrderMonitoringSignals.run({ userId: 2 });
      expect(result.highValueOrderCount).toBe(0);
      expect(result.highValueOrders).toEqual([]);
    });

    it('returns an error for an unknown userId', () => {
      const result = tools.getOrderMonitoringSignals.run({ userId: 999 });
      expect(result).toEqual({ error: 'No user with id 999' });
    });
  });
});

describe('runAgent orchestration (Claude API mocked)', () => {
  it('drives tool_use -> tool execution -> tool_result -> final response', async () => {
    const calls: Anthropic.MessageCreateParams[] = [];

    // Turn 1: the model asks to call getUserOrders(userId: 3). Turn 2: given the
    // real tool result, it produces a final text answer. Two canned responses,
    // no network call — this is the entire fake Anthropic client surface runAgent uses.
    const responses: Partial<Anthropic.Message>[] = [
      {
        stop_reason: 'tool_use',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'getUserOrders', input: { userId: 3 } }],
      },
      {
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'Noam Katz has 3 orders totaling $655.00.', citations: [] }],
      },
    ];

    const fakeClient = {
      messages: {
        stream: (params: Anthropic.MessageCreateParams) => {
          calls.push(params);
          const response = responses[calls.length - 1];
          return { finalMessage: async () => response as Anthropic.Message };
        },
      },
    };

    const result = await runAgent(fakeClient as unknown as Anthropic, "How much has Noam Katz spent?");

    // Final response surfaced correctly.
    expect(result.answer).toBe('Noam Katz has 3 orders totaling $655.00.');
    expect(result.turns).toBe(2);

    // The tool the model asked for was actually recorded as called...
    expect(result.trace).toEqual([{ name: 'getUserOrders', input: { userId: 3 } }]);

    // ...and genuinely executed (not stubbed): the tool_result fed back into the
    // second call carries real order data pulled from MOCK_ORDERS for user 3.
    expect(calls).toHaveLength(2);
    const secondCallMessages = calls[1].messages;
    const toolResultMessage = secondCallMessages.find(
      (m) => Array.isArray(m.content) && m.content.some((b) => b.type === 'tool_result')
    );
    const toolResultBlock = (toolResultMessage!.content as Anthropic.ToolResultBlockParam[]).find(
      (b) => b.type === 'tool_result'
    )!;
    const parsed = JSON.parse(toolResultBlock.content as string);
    expect(parsed.summary).toEqual({ userName: 'Noam Katz', totalAmount: 655 });
    expect(parsed.orders).toEqual(MOCK_ORDERS.filter((o) => o.userId === 3));
  });
});
