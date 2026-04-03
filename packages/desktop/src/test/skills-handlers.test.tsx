import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import Skills from '../pages/Skills';

/**
 * Tests for Skills page install/config behavior:
 * - Built-in skills with missing bins → "Install Dependencies" button
 * - ClawHub skills → "Install" button with clawhub
 * - Search results mapping
 * - Config read/write through correct path
 */

describe('Skills — Install Deps for built-in skills', () => {
  beforeEach(() => {
    const api = window.electronAPI as any;
    api.skillListInstalled = vi.fn().mockResolvedValue({
      success: true,
      skills: {},
      report: {
        skills: [
          {
            name: 'apple-notes',
            description: 'Manage Apple Notes via the memo CLI.',
            source: 'openclaw-bundled',
            bundled: true,
            eligible: false,
            disabled: false,
            blockedByAllowlist: false,
            missing: { bins: ['memo'] },
            install: [
              { id: 'brew-memo', kind: 'brew', label: 'Install via Homebrew', bins: ['memo'] },
            ],
          },
          {
            name: 'coding-agent',
            description: 'Delegate coding tasks.',
            source: 'openclaw-bundled',
            bundled: true,
            eligible: true,
            disabled: false,
            blockedByAllowlist: false,
          },
        ],
      },
    });
    api.skillExplore = vi.fn().mockResolvedValue({ success: true, skills: [] });
    api.skillSearch = vi.fn().mockResolvedValue({ success: true, results: [] });
    api.skillDetail = vi.fn().mockResolvedValue({ success: false });
    api.skillGetConfig = vi.fn().mockResolvedValue({ success: true, config: {} });
    api.skillInstallDeps = vi.fn().mockResolvedValue({ success: true });
  });

  it('shows "Needs Setup" badge for skills missing binaries', async () => {
    await act(async () => { render(<Skills />); });
    await waitFor(() => {
      expect(screen.getByText('apple-notes')).toBeInTheDocument();
    });
    // Should show "Needs Setup" status
    const badges = screen.getAllByText('Needs Setup');
    expect(badges.length).toBeGreaterThan(0);
  });

  it('shows "Install Dependencies" button for built-in skill with install specs', async () => {
    const api = window.electronAPI as any;
    api.skillDetail = vi.fn().mockResolvedValue({ success: false });

    await act(async () => { render(<Skills />); });

    // Click on apple-notes to open detail
    await act(async () => {
      fireEvent.click(screen.getByText('apple-notes'));
    });

    // Should show "Install Dependencies" instead of "Install"
    await waitFor(() => {
      expect(screen.getByText('Install Dependencies')).toBeInTheDocument();
    });
  });

  it('calls skillInstallDeps with correct install specs', async () => {
    const api = window.electronAPI as any;
    api.skillDetail = vi.fn().mockResolvedValue({ success: false });
    api.skillInstallDeps = vi.fn().mockResolvedValue({ success: true });

    await act(async () => { render(<Skills />); });

    // Open detail for apple-notes
    await act(async () => {
      fireEvent.click(screen.getByText('apple-notes'));
    });

    // Click Install Dependencies
    await act(async () => {
      fireEvent.click(screen.getByText('Install Dependencies'));
    });

    expect(api.skillInstallDeps).toHaveBeenCalledWith([
      { id: 'brew-memo', kind: 'brew', label: 'Install via Homebrew', bins: ['memo'] },
    ]);
  });

  it('shows "Ready" for eligible skills in detail modal', async () => {
    const api = window.electronAPI as any;
    api.skillDetail = vi.fn().mockResolvedValue({ success: false });

    await act(async () => { render(<Skills />); });

    await act(async () => {
      fireEvent.click(screen.getByText('coding-agent'));
    });

    await waitFor(() => {
      expect(screen.getAllByText('Ready').length).toBeGreaterThan(0);
    });
  });
});

describe('Skills — ClawHub search mapping', () => {
  beforeEach(() => {
    const api = window.electronAPI as any;
    api.skillListInstalled = vi.fn().mockResolvedValue({
      success: true,
      skills: {},
      report: { skills: [] },
    });
    api.skillExplore = vi.fn().mockResolvedValue({ success: true, skills: [] });
    api.skillDetail = vi.fn().mockResolvedValue({ success: false });
    api.skillGetConfig = vi.fn().mockResolvedValue({ success: true, config: {} });
  });

  it('displays mapped search results with correct field names', async () => {
    const api = window.electronAPI as any;
    // Simulate backend already-mapped results (displayName → name)
    api.skillSearch = vi.fn().mockResolvedValue({
      success: true,
      results: [
        {
          slug: 'memory-tiering',
          name: 'Memory Tiering',
          displayName: 'Memory Tiering',
          description: 'Automated multi-tiered memory management.',
          summary: 'Automated multi-tiered memory management.',
          version: null,
          score: 3.64,
        },
      ],
    });

    await act(async () => { render(<Skills />); });

    const searchInput = screen.getByPlaceholderText(/Search skills/);
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'memory' } });
    });
    await act(async () => {
      fireEvent.keyDown(searchInput, { key: 'Enter', code: 'Enter' });
    });

    await waitFor(() => {
      expect(screen.getByText('Memory Tiering')).toBeInTheDocument();
    });
  });
});

describe('Skills — Config shows for skills with primaryEnv', () => {
  beforeEach(() => {
    const api = window.electronAPI as any;
    api.skillListInstalled = vi.fn().mockResolvedValue({
      success: true,
      skills: {},
      report: {
        skills: [
          {
            name: 'gemini',
            description: 'Gemini model access.',
            source: 'openclaw-bundled',
            bundled: true,
            eligible: false,
            disabled: false,
            blockedByAllowlist: false,
            primaryEnv: 'GEMINI_API_KEY',
            missing: { env: ['GEMINI_API_KEY'] },
          },
        ],
      },
    });
    api.skillExplore = vi.fn().mockResolvedValue({ success: true, skills: [] });
    api.skillSearch = vi.fn().mockResolvedValue({ success: true, results: [] });
    api.skillDetail = vi.fn().mockResolvedValue({ success: false });
    api.skillGetConfig = vi.fn().mockResolvedValue({
      success: true,
      config: {},
      apiKey: '',
      enabled: true,
    });
  });

  it('shows config section for skills with missing env', async () => {
    await act(async () => { render(<Skills />); });

    // Open gemini detail
    await act(async () => {
      fireEvent.click(screen.getByText('gemini'));
    });

    await waitFor(() => {
      expect(screen.getByText('Configuration')).toBeInTheDocument();
    });
  });
});
