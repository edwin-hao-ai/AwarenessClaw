import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import Settings from '../pages/Settings';

describe('Settings Page', () => {
  beforeEach(() => {
    localStorage.clear();
    // Set English language for consistent test assertions
    localStorage.setItem('awareness-claw-config', JSON.stringify({ language: 'en' }));
  });

  it('renders settings header', async () => {
    await act(async () => { render(<Settings />); });
    expect(screen.getByRole('heading', { name: /Settings/ })).toBeInTheDocument();
  });

  it('does not render model section anymore', async () => {
    await act(async () => { render(<Settings />); });
    expect(screen.queryByText(/Current Model/)).not.toBeInTheDocument();
  });

  it('does not render memory settings anymore', async () => {
    await act(async () => { render(<Settings />); });
    expect(screen.queryByText(/Auto Capture/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Auto Recall/)).not.toBeInTheDocument();
  });

  it('renders gateway management', async () => {
    await act(async () => { render(<Settings />); });
    expect(screen.getByText(/OpenClaw Gateway/)).toBeInTheDocument();
  });

  it('renders permissions panel summary', async () => {
    await act(async () => { render(<Settings />); });
    expect(screen.getAllByText(/Host exec policy/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Safe/)).toBeInTheDocument();
    expect(screen.getByText(/Standard/)).toBeInTheDocument();
    expect(screen.getByText(/covers OpenClaw exec approval defaults plus the main agent allowlist/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Main agent allowlist/i).length).toBeGreaterThan(0);
  });

  it('updates exec security from the permissions panel', async () => {
    const api = window.electronAPI as any;
    api.permissionsGet = vi.fn().mockResolvedValue({
      success: true,
      profile: 'coding',
      alsoAllow: [],
      denied: [],
      execSecurity: 'allowlist',
      execAsk: 'on-miss',
      execAskFallback: 'deny',
      execAutoAllowSkills: false,
      execAllowlist: [],
    });
    api.permissionsUpdate = vi.fn().mockResolvedValue({ success: true });

    await act(async () => { render(<Settings />); });

    await act(async () => {
      fireEvent.click(screen.getAllByText('Full')[0]);
    });

    expect(api.permissionsUpdate).toHaveBeenCalledWith(expect.objectContaining({ execSecurity: 'full' }));
  });

  it('adds an exec allowlist pattern from the permissions panel', async () => {
    const api = window.electronAPI as any;
    api.permissionsGet = vi.fn().mockResolvedValue({
      success: true,
      profile: 'coding',
      alsoAllow: [],
      denied: [],
      execSecurity: 'allowlist',
      execAsk: 'on-miss',
      execAskFallback: 'deny',
      execAutoAllowSkills: false,
      execAllowlist: [],
    });
    api.permissionsUpdate = vi.fn().mockResolvedValue({ success: true });

    await act(async () => { render(<Settings />); });

    const input = screen.getByPlaceholderText('/opt/homebrew/bin/rg or ~/Projects/**/bin/tool');
    await act(async () => {
      fireEvent.change(input, { target: { value: '/opt/homebrew/bin/rg' } });
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('add-allowlist-pattern'));
    });

    expect(api.permissionsUpdate).toHaveBeenCalledWith(expect.objectContaining({
      execAllowlist: [expect.objectContaining({ pattern: '/opt/homebrew/bin/rg' })],
    }));
  });

  it('renders system section', async () => {
    await act(async () => { render(<Settings />); });
    expect(screen.getByText('AwarenessClaw')).toBeInTheDocument();
  });

  // --- Token Optimization tests ---

  it('renders Token Optimization section', async () => {
    await act(async () => { render(<Settings />); });
    expect(screen.getByText(/Token Optimization/)).toBeInTheDocument();
  });

  it('renders Thinking Level selector with default value', async () => {
    await act(async () => { render(<Settings />); });
    expect(screen.getByText('Thinking Level')).toBeInTheDocument();
    const select = screen.getByDisplayValue('Low (default)');
    expect(select).toBeInTheDocument();
  });

  it('renders token estimate display', async () => {
    await act(async () => { render(<Settings />); });
    expect(screen.getByText('Token Estimate')).toBeInTheDocument();
    expect(screen.getByText(/overhead/)).toBeInTheDocument();
  });

  it('updates thinking level when changed', async () => {
    await act(async () => { render(<Settings />); });

    const select = screen.getByDisplayValue('Low (default)');
    await act(async () => {
      fireEvent.change(select, { target: { value: 'high' } });
    });

    const config = JSON.parse(localStorage.getItem('awareness-claw-config') || '{}');
    expect(config.thinkingLevel).toBe('high');
  });

  it('does not render Recall Limit in Token Optimization section', async () => {
    await act(async () => { render(<Settings />); });
    expect(screen.queryByText('Recall Limit')).not.toBeInTheDocument();
  });

  it('does not render model restart hint on settings page', async () => {
    await act(async () => { render(<Settings />); });
    expect(screen.queryByText(/new chat session/)).not.toBeInTheDocument();
  });

  it('collapses advanced web settings by default', async () => {
    await act(async () => { render(<Settings />); });
    expect(screen.getByText(/Web & Browser/)).toBeInTheDocument();
    expect(screen.getByText(/Brave Search needs an API key/)).toBeInTheDocument();
    expect(screen.getAllByText(/Show advanced/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Most users only need to pick a search provider/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Search provider/i).length).toBeGreaterThan(1);
    expect(screen.getByText(/^API key$/i)).toBeInTheDocument();
    expect(screen.queryByText(/Max results/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Enable fetch tool/i)).not.toBeInTheDocument();
  });

  it('reveals advanced web settings when expanded', async () => {
    await act(async () => { render(<Settings />); });
    await act(async () => {
      fireEvent.click(screen.getAllByText(/Show advanced/i)[0]);
    });
    expect(screen.getByText(/Hide advanced/)).toBeInTheDocument();
    expect(screen.getByText(/Max results/i)).toBeInTheDocument();
  });
});
