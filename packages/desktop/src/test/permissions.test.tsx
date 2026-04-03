import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import Settings from '../pages/Settings';

describe('Settings Page — Permissions Panel', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('awareness-claw-config', JSON.stringify({ language: 'en' }));
  });

  it('renders the Permissions section after loading', async () => {
    await act(async () => { render(<Settings />); });
    await waitFor(() => {
      expect(screen.getByText(/Permissions/)).toBeInTheDocument();
    });
  });

  it('displays preset cards (Safe, Standard, Developer)', async () => {
    await act(async () => { render(<Settings />); });
    await waitFor(() => {
      // New UI shows preset cards instead of "Tools Profile" label
      expect(screen.getByText('Safe')).toBeInTheDocument();
      expect(screen.getByText('Standard')).toBeInTheDocument();
      expect(screen.getByText('Developer')).toBeInTheDocument();
    });
  });

  it('calls permissionsUpdate when toggling a denied command via advanced settings', async () => {
    // Override permissionsGet to return camera.snap as denied
    const api = window.electronAPI as any;
    const origGet = api.permissionsGet;
    const origUpdate = api.permissionsUpdate;
    const updateSpy = vi.fn(() => Promise.resolve({ success: true }));

    api.permissionsGet = () => Promise.resolve({
      success: true,
      profile: 'coding',
      alsoAllow: ['awareness_recall'],
      denied: ['camera.snap'],
      execAsk: 'on-miss',
    });
    api.permissionsUpdate = updateSpy;

    await act(async () => { render(<Settings />); });

    // Wait for permissions to load — preset cards should be visible
    await waitFor(() => {
      expect(screen.getByText('Safe')).toBeInTheDocument();
    });

    // Open advanced settings to see the checkbox-based tool/command pickers
    const advancedBtns = screen.getAllByText(/Show advanced/i);
    const advancedBtn = advancedBtns[advancedBtns.length - 1];
    await act(async () => { fireEvent.click(advancedBtn); });

    // In advanced mode, "Camera" is a known denied command shown as a checkbox button.
    // Click it to toggle it off (remove from denied).
    const cameraBtn = screen.getAllByText('Camera')[1].closest('button');
    expect(cameraBtn).toBeTruthy();

    await act(async () => {
      fireEvent.click(cameraBtn!);
    });

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalled();
    });

    // Should be called with camera.snap removed from denied
    expect(updateSpy).toHaveBeenCalledWith({ denied: [] });

    // Restore
    api.permissionsGet = origGet;
    api.permissionsUpdate = origUpdate;
  });

  it('applies developer preset with host approvals disabled', async () => {
    const api = window.electronAPI as any;
    const origGet = api.permissionsGet;
    const origUpdate = api.permissionsUpdate;
    const updateSpy = vi.fn(() => Promise.resolve({ success: true }));

    api.permissionsGet = () => Promise.resolve({
      success: true,
      profile: 'coding',
      alsoAllow: ['awareness_init', 'awareness_get_agent_prompt'],
      denied: ['exec'],
      execAsk: 'on-miss',
    });
    api.permissionsUpdate = updateSpy;

    await act(async () => { render(<Settings />); });

    await waitFor(() => {
      expect(screen.getByText('Developer')).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByText('Developer'));
    });

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ execAsk: 'off' }));
    });

    expect(updateSpy).toHaveBeenCalledWith({
      alsoAllow: [
        'awareness_init',
        'awareness_get_agent_prompt',
        'exec',
        'awareness_recall',
        'awareness_record',
        'awareness_lookup',
        'awareness_perception',
      ],
      denied: [],
      execAsk: 'off',
      execSecurity: 'full',
      execAskFallback: 'full',
      execAutoAllowSkills: true,
    });

    api.permissionsGet = origGet;
    api.permissionsUpdate = origUpdate;
  });

  it('shows clear allowed and available permission summaries', async () => {
    const api = window.electronAPI as any;
    const origGet = api.permissionsGet;

    api.permissionsGet = () => Promise.resolve({
      success: true,
      profile: 'coding',
      alsoAllow: ['awareness_recall', 'exec'],
      denied: ['camera.snap'],
      execAsk: 'on-miss',
    });

    await act(async () => { render(<Settings />); });

    await waitFor(() => {
      expect(screen.getByText('Already Allowed')).toBeInTheDocument();
      expect(screen.getByText('Can Be Enabled')).toBeInTheDocument();
      expect(screen.getByText('Blocked Right Now')).toBeInTheDocument();
    });

    expect(screen.getByText('Memory Recall')).toBeInTheDocument();
    expect(screen.getByText('Shell Commands')).toBeInTheDocument();
    expect(screen.getByText('Camera')).toBeInTheDocument();

    api.permissionsGet = origGet;
  });

  it('shows provider guidance when Brave web search is selected', async () => {
    await act(async () => { render(<Settings />); });

    await waitFor(() => {
      expect(screen.getByText('Brave search needs an API key')).toBeInTheDocument();
    });
    expect(screen.getByText(/Current status: provider selected, but credential is still missing/i)).toBeInTheDocument();
  });
});
