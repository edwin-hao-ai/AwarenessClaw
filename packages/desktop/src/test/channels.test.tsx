import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import Channels from '../pages/Channels';

describe('Channels Page', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('awareness-claw-config', JSON.stringify({ language: 'en' }));
  });

  it('renders channels header', async () => {
    await act(async () => { render(<Channels />); });
    expect(screen.getByText(/Channels/)).toBeInTheDocument();
  });

  it('renders local chat as connected', async () => {
    await act(async () => { render(<Channels />); });
    expect(screen.getByText(/Local Chat/)).toBeInTheDocument();
  });

  it('renders configured channels as connected', async () => {
    await act(async () => { render(<Channels />); });
    await waitFor(() => {
      const telegramElements = screen.getAllByText('Telegram');
      expect(telegramElements.length).toBeGreaterThan(0);
    });
  });

  it('renders unconfigured channels as available', async () => {
    await act(async () => { render(<Channels />); });
    expect(screen.getByText('WhatsApp')).toBeInTheDocument();
    expect(screen.getByText('Discord')).toBeInTheDocument();
  });

  it('opens wizard when clicking available channel', async () => {
    await act(async () => { render(<Channels />); });
    const discordBtn = screen.getByText('Discord').closest('button');
    if (discordBtn) {
      await act(async () => { fireEvent.click(discordBtn); });
      expect(screen.getByText(/Connect Discord/)).toBeInTheDocument();
    }
  });

  it('shows disconnect button on configured channels (not on local)', async () => {
    await act(async () => { render(<Channels />); });
    // Wait for registry to load and channels to render
    await waitFor(() => {
      const disconnectBtns = screen.queryAllByTitle('Disconnect');
      expect(disconnectBtns.length).toBeGreaterThan(0);
    });
    // At least one disconnect button exists (for configured non-local channels)
    const disconnectBtns = screen.getAllByTitle('Disconnect');
    expect(disconnectBtns.length).toBeGreaterThanOrEqual(1);
    // Local Chat should NOT have a disconnect button — its parent has no such button
    const localText = screen.getByText('Local Chat');
    const localCard = localText.closest('div[class*="rounded-xl"]');
    expect(localCard).toBeTruthy();
    expect(localCard?.querySelector('button[title="Disconnect"]')).toBeNull();
  });

  it('shows confirmation dialog when clicking disconnect', async () => {
    await act(async () => { render(<Channels />); });
    await waitFor(() => {
      expect(screen.queryAllByTitle('Disconnect').length).toBeGreaterThan(0);
    });

    const disconnectBtn = screen.getAllByTitle('Disconnect')[0];
    await act(async () => { fireEvent.click(disconnectBtn); });

    // Confirmation dialog should appear
    expect(screen.getByText('Disconnect Channel')).toBeInTheDocument();
    expect(screen.getByText(/remove the channel configuration/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('calls channelRemove when confirmed', async () => {
    const api = window.electronAPI as any;
    api.channelRemove = vi.fn().mockResolvedValue({ success: true });

    await act(async () => { render(<Channels />); });
    await waitFor(() => {
      expect(screen.queryAllByTitle('Disconnect').length).toBeGreaterThan(0);
    });

    // Click disconnect
    const disconnectBtn = screen.getAllByTitle('Disconnect')[0];
    await act(async () => { fireEvent.click(disconnectBtn); });

    // Confirm dialog visible
    expect(screen.getByText('Disconnect Channel')).toBeInTheDocument();

    // Find confirm button (the red one in the dialog, not the title tooltip button)
    const confirmDialog = screen.getByText('Disconnect Channel').closest('div[class*="fixed"]');
    const confirmBtn = confirmDialog?.querySelector('button[class*="bg-red"]') as HTMLElement;
    expect(confirmBtn).toBeTruthy();

    await act(async () => { fireEvent.click(confirmBtn); });

    // channelRemove should have been called
    expect(api.channelRemove).toHaveBeenCalled();
  });

  it('closes confirmation dialog when cancel is clicked', async () => {
    await act(async () => { render(<Channels />); });
    await waitFor(() => {
      expect(screen.queryAllByTitle('Disconnect').length).toBeGreaterThan(0);
    });

    const disconnectBtn = screen.getAllByTitle('Disconnect')[0];
    await act(async () => { fireEvent.click(disconnectBtn); });

    // Dialog visible
    expect(screen.getByText('Disconnect Channel')).toBeInTheDocument();

    // Click cancel
    const cancelBtn = screen.getByRole('button', { name: 'Cancel' });
    await act(async () => { fireEvent.click(cancelBtn); });

    // Dialog should be gone
    expect(screen.queryByText('Disconnect Channel')).not.toBeInTheDocument();
  });

  it('opens official OpenClaw tutorial link and disables the button while opening', async () => {
    const api = window.electronAPI as any;
    let resolveOpen: (() => void) | null = null;
    api.openExternal = vi.fn().mockImplementation(() => new Promise<void>((resolve) => {
      resolveOpen = resolve;
    }));

    await act(async () => { render(<Channels />); });

    const discordBtn = screen.getByText('Discord').closest('button');
    expect(discordBtn).toBeTruthy();

    await act(async () => {
      fireEvent.click(discordBtn as HTMLButtonElement);
    });

    const tutorialButton = screen.getByRole('button', { name: /View detailed tutorial/i });

    await act(async () => {
      fireEvent.click(tutorialButton);
    });

    expect(api.openExternal).toHaveBeenCalledWith('https://docs.openclaw.ai/channels/discord');
    expect(tutorialButton).toBeDisabled();

    await act(async () => {
      resolveOpen?.();
    });

    await waitFor(() => {
      expect(tutorialButton).not.toBeDisabled();
    });
  });
});
