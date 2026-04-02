import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import BootstrapWizard from '../components/BootstrapWizard';

describe('BootstrapWizard', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('awareness-claw-config', JSON.stringify({ language: 'en' }));
    vi.restoreAllMocks();
  });

  it('writes onboarding files through the main agent workspace flow', async () => {
    const api = window.electronAPI as any;
    api.agentsWriteFile = vi.fn().mockResolvedValue({ success: true });
    const onComplete = vi.fn();

    await act(async () => {
      render(<BootstrapWizard onComplete={onComplete} onSkip={vi.fn()} />);
    });

    await act(async () => {
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Edwin' } });
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    });

    await act(async () => {
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Claw' } });
      fireEvent.click(screen.getByRole('button', { name: /start chatting/i }));
    });

    await waitFor(() => {
      expect(api.agentsWriteFile).toHaveBeenCalledTimes(3);
      expect(api.agentsWriteFile).toHaveBeenNthCalledWith(1, 'main', 'USER.md', expect.stringContaining('Edwin'));
      expect(api.agentsWriteFile).toHaveBeenNthCalledWith(2, 'main', 'SOUL.md', expect.stringContaining('# Claw'));
      expect(api.agentsWriteFile).toHaveBeenNthCalledWith(3, 'main', 'IDENTITY.md', expect.stringContaining('**name**: Claw'));
      expect(onComplete).toHaveBeenCalled();
    });
  });
});