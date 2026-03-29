import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import Dashboard from '../pages/Dashboard';

describe('Dashboard Session Management', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows session sidebar when toggled', async () => {
    await act(async () => { render(<Dashboard />); });
    // Click hamburger menu (first button in header)
    const buttons = screen.getAllByRole('button');
    await act(async () => { fireEvent.click(buttons[0]); });
    // Should show sidebar with "新对话" button (might be multiple matches)
    const newBtns = screen.getAllByText(/新对话/);
    expect(newBtns.length).toBeGreaterThan(0);
  });

  it('stores sessions in localStorage', async () => {
    await act(async () => { render(<Dashboard />); });
    const sessions = JSON.parse(localStorage.getItem('awareness-claw-sessions') || '[]');
    // At least one default session should be created
    expect(sessions.length).toBeGreaterThanOrEqual(1);
  });
});
