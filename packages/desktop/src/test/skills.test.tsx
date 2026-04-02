import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import Skills from '../pages/Skills';

describe('Skills Page', () => {
  beforeEach(() => {
    const api = window.electronAPI as any;
    api.skillListInstalled = vi.fn().mockResolvedValue({
      success: true,
      skills: {},
      report: {
        skills: [
          {
            name: 'coding-agent',
            description: 'Delegate coding tasks.',
            source: 'openclaw-bundled',
            bundled: true,
            eligible: true,
            disabled: false,
            blockedByAllowlist: false,
          },
          {
            name: 'blogwatcher',
            description: 'Watch blog feeds.',
            source: 'openclaw-bundled',
            bundled: true,
            eligible: false,
            disabled: false,
            blockedByAllowlist: false,
            missing: { bins: ['blogwatcher'] },
          },
          {
            name: 'custom-skill',
            description: 'Workspace custom skill.',
            source: 'workspace',
            bundled: false,
            eligible: false,
            disabled: true,
            blockedByAllowlist: false,
          },
        ],
      },
    });
    api.skillExplore = vi.fn().mockResolvedValue({
      success: true,
      skills: [
        { slug: 'github', name: 'GitHub', description: 'GitHub integration', version: '1.0.0' },
      ],
    });
    api.skillSearch = vi.fn().mockResolvedValue({ success: true, results: [] });
    api.skillDetail = vi.fn().mockResolvedValue({ success: false });
    api.skillGetConfig = vi.fn().mockResolvedValue({ success: true, config: {} });
  });

  it('renders skills header', async () => {
    await act(async () => { render(<Skills />); });
    expect(screen.getByText('Skills')).toBeInTheDocument();
  });

  it('renders search input', async () => {
    await act(async () => { render(<Skills />); });
    expect(screen.getByPlaceholderText(/Search skills/)).toBeInTheDocument();
  });

  it('renders filter tabs', async () => {
    await act(async () => { render(<Skills />); });
    expect(screen.getByRole('button', { name: 'Explore' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Installed' })).toBeInTheDocument();
  });

  it('renders refreshed skills actions', async () => {
    await act(async () => { render(<Skills />); });
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ClawHub/ })).toBeInTheDocument();
  });

  it('renders official local skills summary section', async () => {
    await act(async () => { render(<Skills />); });
    expect(await screen.findByText('OpenClaw Local Skills')).toBeInTheDocument();
    expect(screen.getByText('coding-agent')).toBeInTheDocument();
  });

  it('filters local skills by status', async () => {
    await act(async () => { render(<Skills />); });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Disabled 1/ }));
    });

    expect(screen.getByText('custom-skill')).toBeInTheDocument();
    expect(screen.queryByText('coding-agent')).not.toBeInTheDocument();
  });
});
