import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import Agents from '../pages/Agents';

describe('Agents page', () => {
  beforeEach(() => {
    // Ensure English locale
    localStorage.setItem('awareness-claw-config', JSON.stringify({ language: 'en' }));
  });

  it('renders agent name "Claw" and emoji "🦞"', async () => {
    await act(async () => { render(<Agents />); });
    await waitFor(() => {
      expect(screen.getByText('Claw')).toBeInTheDocument();
      expect(screen.getByText('🦞')).toBeInTheDocument();
    });
  });

  it('shows "Default" badge for default agent', async () => {
    await act(async () => { render(<Agents />); });
    await waitFor(() => {
      expect(screen.getByText('Default')).toBeInTheDocument();
    });
  });

  it('shows binding "telegram"', async () => {
    await act(async () => { render(<Agents />); });
    await waitFor(() => {
      expect(screen.getByText('telegram')).toBeInTheDocument();
    });
  });

  it('opens wizard after clicking Create Agent', async () => {
    await act(async () => { render(<Agents />); });
    await waitFor(() => expect(screen.getByText(/Create Agent/i)).toBeInTheDocument());
    await act(async () => { fireEvent.click(screen.getByText(/Create Agent/i)); });
    // Wizard should show step 1 with name input
    await waitFor(() => {
      expect(screen.getByText('Name your agent')).toBeInTheDocument();
    });
  });

  it('default agent does not have a delete button', async () => {
    await act(async () => { render(<Agents />); });
    await waitFor(() => {
      expect(screen.getByText('Claw')).toBeInTheDocument();
    });
    // Trash2 icon buttons have title or are inside agent cards.
    // The default agent (isDefault=true) should NOT render the Trash2 button.
    // There is only one agent in the mock, and it is default, so there should be no Trash2 at all.
    const allButtons = screen.getAllByRole('button');
    // Check none of the buttons is a delete button (Trash2 rendered with lucide-react)
    const deleteButtons = allButtons.filter(btn => {
      // The delete button has no title but contains an svg with class lucide-trash-2
      const svg = btn.querySelector('.lucide-trash-2');
      return svg !== null;
    });
    expect(deleteButtons).toHaveLength(0);
  });

  it('shows AGENTS.md in the agent file editor', async () => {
    await act(async () => { render(<Agents />); });
    await waitFor(() => {
      expect(screen.getByText('Claw')).toBeInTheDocument();
    });

    const editDefinitionButton = screen.getAllByRole('button').find((button) => button.getAttribute('title') === 'Edit Definition');
    expect(editDefinitionButton).toBeTruthy();

    await act(async () => {
      fireEvent.click(editDefinitionButton!);
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'AGENTS.md' })).toBeInTheDocument();
    });
  });
});
