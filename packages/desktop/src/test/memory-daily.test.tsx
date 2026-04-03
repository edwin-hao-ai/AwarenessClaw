import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, screen, act, waitFor, fireEvent } from '@testing-library/react';
import Memory from '../pages/Memory';

/** Helper: create a connected daemon mock with custom overrides */
function connectedDaemonApi(overrides: Record<string, any> = {}) {
  const origAPI = (window as any).electronAPI;
  return {
    ...origAPI,
    memoryCheckHealth: () => Promise.resolve({
      status: 'ok', version: '0.4.1', search_mode: 'hybrid',
      stats: { totalMemories: 5, totalKnowledge: 1, totalTasks: 0, totalSessions: 2 },
    }),
    memoryGetEvents: () => Promise.resolve({ items: [], total: 0 }),
    ...overrides,
  };
}

describe('Memory Page — Daily Summary', () => {
  let origAPI: any;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('awareness-claw-config', JSON.stringify({ language: 'en' }));
    origAPI = (window as any).electronAPI;
  });

  afterEach(() => {
    (window as any).electronAPI = origAPI;
  });

  it('shows Daily Summary when memoryGetDailySummary returns data', async () => {
    (window as any).electronAPI = connectedDaemonApi({
      memoryGetContext: () => Promise.resolve({
        result: { content: [{ text: JSON.stringify({
          knowledge_cards: [
            { id: 'k1', category: 'decision', title: 'Test decision', summary: 'Test' },
          ],
          open_tasks: [{ id: 't1', title: 'Task 1' }],
        }) }] },
      }),
      memoryGetCards: () => Promise.resolve({
        result: { content: [{ text: JSON.stringify({ knowledge_cards: [
          { id: 'k1', category: 'decision', title: 'Use PostgreSQL', summary: 'Chose PG for pgvector' },
        ] }) }] },
      }),
      memoryGetDailySummary: () => Promise.resolve({
        cards: { result: { content: [{ text: JSON.stringify({ knowledge_cards: [
          { category: 'decision', title: 'Test decision', summary: 'Test' },
        ] }) }] } },
        tasks: { result: { content: [{ text: JSON.stringify({ action_items: [{ title: 'Task 1' }] }) }] } },
      }),
    });

    await act(async () => { render(<Memory />); });
    // Switch to knowledge tab to see Daily Summary
    await waitFor(() => expect(screen.getAllByText(/Knowledge Cards/).length).toBeGreaterThan(0));
    await act(async () => { fireEvent.click(screen.getAllByText(/Knowledge Cards/)[0]); });

    await waitFor(() => {
      expect(screen.getByText('Daily Summary')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Test decision').length).toBeGreaterThan(0);
    expect(screen.getByText(/open tasks/)).toBeInTheDocument();
  });

  it('uses memoryGetContext as the primary source for cards and summary', async () => {
    (window as any).electronAPI = connectedDaemonApi({
      memoryGetContext: () => Promise.resolve({
        result: { content: [{ text: JSON.stringify({
          knowledge_cards: [
            { id: 'ctx-1', category: 'workflow', title: 'Context-first card', summary: 'Loaded from awareness_init.' },
          ],
          open_tasks: [{ id: 'ctx-task-1', title: 'Context task' }],
        }) }] },
      }),
      memoryGetCards: () => Promise.resolve({ error: 'should not be needed' }),
      memoryGetDailySummary: () => Promise.resolve({
        cards: { result: { content: [{ text: JSON.stringify({ knowledge_cards: [] }) }] } },
        tasks: { result: { content: [{ text: JSON.stringify({ action_items: [] }) }] } },
      }),
    });

    await act(async () => { render(<Memory />); });
    await waitFor(() => expect(screen.getAllByText(/Knowledge Cards/).length).toBeGreaterThan(0));
    await act(async () => { fireEvent.click(screen.getAllByText(/Knowledge Cards/)[0]); });

    await waitFor(() => {
      expect(screen.getByText('Daily Summary')).toBeInTheDocument();
    });
    expect(screen.getAllByText('Context-first card').length).toBeGreaterThan(0);
  });

  it('does not show Daily Summary when memoryGetDailySummary returns empty data', async () => {
    (window as any).electronAPI = connectedDaemonApi({
      memoryGetContext: () => Promise.resolve({
        result: { content: [{ text: JSON.stringify({ knowledge_cards: [], open_tasks: [] }) }] },
      }),
      memoryGetCards: () => Promise.resolve({
        result: { content: [{ text: JSON.stringify({ knowledge_cards: [
          { id: 'k1', category: 'insight', title: 'Some insight', summary: 'Detail' },
        ] }) }] },
      }),
      memoryGetDailySummary: () => Promise.resolve({
        cards: { result: { content: [{ text: JSON.stringify({ knowledge_cards: [] }) }] } },
        tasks: { result: { content: [{ text: JSON.stringify({ action_items: [] }) }] } },
      }),
    });

    await act(async () => { render(<Memory />); });
    await waitFor(() => expect(screen.getAllByText(/Knowledge Cards/).length).toBeGreaterThan(0));
    await act(async () => { fireEvent.click(screen.getAllByText(/Knowledge Cards/)[0]); });

    await waitFor(() => {
      expect(screen.getByText('Some insight')).toBeInTheDocument();
    });
    expect(screen.queryByText('Daily Summary')).not.toBeInTheDocument();
  });

  it('does not show Daily Summary when daemon is offline', async () => {
    // Default mock: daemon not connected → shows Start Daemon, no Daily Summary
    await act(async () => { render(<Memory />); });
    await waitFor(() => {
      expect(screen.getByText('Start Daemon')).toBeInTheDocument();
    });
    expect(screen.queryByText('Daily Summary')).not.toBeInTheDocument();
  });
});
