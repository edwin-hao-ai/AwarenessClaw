/**
 * Tests for Setup Wizard API Key validation flow.
 *
 * Covers:
 * - Valid key: proceeds to next step
 * - Invalid key: shows error, blocks Next
 * - Network error: shows error, blocks Next
 * - Skip validation ("Continue anyway"): proceeds despite failure
 * - No-key provider (Ollama): skips validation entirely
 * - Switching provider clears previous error
 * - Button shows "Verifying..." spinner during validation
 * - Already-configured model: skips model step entirely
 */

import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SetupWizard from '../pages/Setup';

// Helper: get to model step quickly by clicking Start and waiting for install to complete
async function advanceToModelStep(overrides?: Partial<Record<string, Mock>>) {
  const api = window.electronAPI as any;

  // Default: env has everything installed, no existing model config
  api.detectEnvironment = vi.fn().mockResolvedValue({
    platform: 'darwin', arch: 'arm64', home: '/Users/test',
    systemNodeInstalled: true, systemNodeVersion: 'v22.0.0',
    npmInstalled: true, openclawInstalled: true, openclawVersion: '2026.3.23',
    hasExistingConfig: false,
  });
  api.readExistingConfig = vi.fn().mockResolvedValue({
    exists: false, hasProviders: false, providers: [], primaryModel: '', hasApiKey: false,
  });
  api.installNodeJs = vi.fn().mockResolvedValue({ success: true, alreadyInstalled: true });
  api.installOpenClaw = vi.fn().mockResolvedValue({ success: true, alreadyInstalled: true });
  api.installPlugin = vi.fn().mockResolvedValue({ success: true });
  api.startDaemon = vi.fn().mockResolvedValue({ success: true });
  api.bootstrap = vi.fn().mockResolvedValue({ success: true });
  api.saveConfig = vi.fn().mockResolvedValue({ success: true });

  // Apply overrides (e.g. custom modelsDiscover mock)
  Object.assign(api, overrides);

  const onComplete = vi.fn();
  await act(async () => {
    render(<SetupWizard onComplete={onComplete} />);
  });

  // Click Start
  const startBtn = screen.getByRole('button', { name: /start/i });
  await act(async () => {
    fireEvent.click(startBtn);
  });

  // Wait for model step to appear
  await waitFor(() => {
    expect(screen.getByText(/choose your ai brain/i)).toBeInTheDocument();
  }, { timeout: 5000 });

  return { api, onComplete };
}

// Helper: select a provider that needs API key
function selectProvider(name: RegExp) {
  const providerBtn = screen.getByRole('button', { name });
  fireEvent.click(providerBtn);
}

// Helper: fill API key input
function fillApiKey(key: string) {
  const input = screen.getByPlaceholderText(/paste your api key/i);
  fireEvent.change(input, { target: { value: key } });
}

async function advanceToDoneStep(overrides?: Partial<Record<string, Mock>>) {
  const context = await advanceToModelStep(overrides);

  selectProvider(/Ollama/i);

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
  });

  await waitFor(() => {
    expect(screen.getByText(/cross-device memory/i)).toBeInTheDocument();
  });

  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /next/i }));
  });

  await waitFor(() => {
    expect(screen.getByText(/your ai assistant is ready/i)).toBeInTheDocument();
  });

  return context;
}

describe('Setup Wizard — API Key Validation', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('awareness-claw-config', JSON.stringify({ language: 'en' }));
    vi.restoreAllMocks();
  });

  it('valid key: proceeds to memory step', async () => {
    const { api } = await advanceToModelStep({
      modelsDiscover: vi.fn().mockResolvedValue({ success: true, models: [{ id: 'gpt-4o', name: 'GPT-4o' }] }),
    });

    selectProvider(/OpenAI/);
    fillApiKey('sk-valid-key');

    const nextBtn = screen.getByRole('button', { name: /next/i });
    await act(async () => {
      fireEvent.click(nextBtn);
    });

    // Should call modelsDiscover for validation
    await waitFor(() => {
      expect(api.modelsDiscover).toHaveBeenCalledWith({
        providerKey: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: 'sk-valid-key',
      });
    });

    // Should advance to memory step
    await waitFor(() => {
      expect(screen.getByText(/cross-device memory/i)).toBeInTheDocument();
    });
  });

  it('invalid key: shows error and blocks navigation', async () => {
    await advanceToModelStep({
      modelsDiscover: vi.fn().mockResolvedValue({ success: false, models: [], error: 'HTTP 401' }),
    });

    selectProvider(/OpenAI/);
    fillApiKey('sk-invalid');

    const nextBtn = screen.getByRole('button', { name: /next/i });
    await act(async () => {
      fireEvent.click(nextBtn);
    });

    // Should show error message
    await waitFor(() => {
      expect(screen.getByText(/HTTP 401/i)).toBeInTheDocument();
    });

    // Should NOT advance — model step title still visible
    expect(screen.getByText(/choose your ai brain/i)).toBeInTheDocument();
  });

  it('network error: shows fallback error message', async () => {
    await advanceToModelStep({
      modelsDiscover: vi.fn().mockRejectedValue(new Error('fetch failed')),
    });

    selectProvider(/OpenAI/);
    fillApiKey('sk-network-error');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/could not connect/i)).toBeInTheDocument();
    });
  });

  it('"Continue anyway" skips validation failure and proceeds', async () => {
    await advanceToModelStep({
      modelsDiscover: vi.fn().mockResolvedValue({ success: false, models: [], error: 'HTTP 403' }),
    });

    selectProvider(/OpenAI/);
    fillApiKey('sk-forbidden-but-user-wants-to-skip');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    });

    // Wait for error to appear
    await waitFor(() => {
      expect(screen.getByText(/HTTP 403/i)).toBeInTheDocument();
    });

    // Click "Continue anyway"
    await act(async () => {
      fireEvent.click(screen.getByText(/continue anyway/i));
    });

    // Should advance to memory step
    await waitFor(() => {
      expect(screen.getByText(/cross-device memory/i)).toBeInTheDocument();
    });
  });

  it('local provider (no key needed): skips validation entirely', async () => {
    const { api } = await advanceToModelStep({
      modelsDiscover: vi.fn(),
    });

    // Select Ollama (no key needed)
    selectProvider(/Ollama/i);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    });

    // modelsDiscover should NOT be called for local providers
    expect(api.modelsDiscover).not.toHaveBeenCalled();

    // Should advance to memory step
    await waitFor(() => {
      expect(screen.getByText(/cross-device memory/i)).toBeInTheDocument();
    });
  });

  it('switching provider clears previous validation error', async () => {
    await advanceToModelStep({
      modelsDiscover: vi.fn().mockResolvedValue({ success: false, models: [], error: 'HTTP 401' }),
    });

    selectProvider(/OpenAI/);
    fillApiKey('sk-bad');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    });

    // Error should be visible
    await waitFor(() => {
      expect(screen.getByText(/HTTP 401/i)).toBeInTheDocument();
    });

    // Switch to another provider
    selectProvider(/DeepSeek/);

    // Error should be cleared
    expect(screen.queryByText(/HTTP 401/i)).not.toBeInTheDocument();
  });

  it('shows "Verifying..." spinner on button during validation', async () => {
    // Create a mock that resolves slowly
    let resolveDiscover: (v: any) => void;
    const discoverPromise = new Promise((r) => { resolveDiscover = r; });

    await advanceToModelStep({
      modelsDiscover: vi.fn().mockReturnValue(discoverPromise),
    });

    selectProvider(/OpenAI/);
    fillApiKey('sk-slow-validation');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    });

    // Should show "Verifying..." text
    await waitFor(() => {
      expect(screen.getByText(/verifying/i)).toBeInTheDocument();
    });

    // Button should be disabled during validation
    const btns = screen.getAllByRole('button');
    const nextBtn = btns.find(b => b.textContent?.match(/verifying/i));
    expect(nextBtn).toBeDisabled();

    // Resolve the mock
    await act(async () => {
      resolveDiscover!({ success: true, models: [{ id: 'gpt-4o', name: 'GPT-4o' }] });
    });

    // Should advance to memory step
    await waitFor(() => {
      expect(screen.getByText(/cross-device memory/i)).toBeInTheDocument();
    });
  });

  it('already-configured model: skips model step entirely', async () => {
    const api = window.electronAPI as any;

    api.detectEnvironment = vi.fn().mockResolvedValue({
      platform: 'darwin', arch: 'arm64', home: '/Users/test',
      systemNodeInstalled: true, systemNodeVersion: 'v22.0.0',
      npmInstalled: true, openclawInstalled: true, openclawVersion: '2026.3.23',
      hasExistingConfig: true,
    });
    // This time readExistingConfig returns hasProviders: true
    api.readExistingConfig = vi.fn().mockResolvedValue({
      exists: true, hasProviders: true, providers: ['openai'], primaryModel: 'gpt-4o', hasApiKey: true,
    });
    api.installNodeJs = vi.fn().mockResolvedValue({ success: true, alreadyInstalled: true });
    api.installOpenClaw = vi.fn().mockResolvedValue({ success: true, alreadyInstalled: true });
    api.installPlugin = vi.fn().mockResolvedValue({ success: true });
    api.startDaemon = vi.fn().mockResolvedValue({ success: true });
    api.bootstrap = vi.fn().mockResolvedValue({ success: true });
    api.modelsDiscover = vi.fn();

    const onComplete = vi.fn();
    await act(async () => {
      render(<SetupWizard onComplete={onComplete} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start/i }));
    });

    // Should jump directly to memory step (skipping model)
    await waitFor(() => {
      expect(screen.getByText(/cross-device memory/i)).toBeInTheDocument();
    }, { timeout: 5000 });

    // Should show "already configured" notice
    expect(screen.getByText(/already configured/i)).toBeInTheDocument();
    expect(screen.getByText(/gpt-4o/i)).toBeInTheDocument();

    // modelsDiscover should NOT have been called
    expect(api.modelsDiscover).not.toHaveBeenCalled();
  });

  it('first install applies onboarding permission defaults when setup completes', async () => {
    const permissionsUpdate = vi.fn().mockResolvedValue({ success: true });
    const { api, onComplete } = await advanceToDoneStep({ permissionsUpdate });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    });

    await waitFor(() => {
      expect(api.permissionsUpdate).toHaveBeenCalledWith(expect.objectContaining({
        execSecurity: 'full',
        execAsk: 'off',
        execAskFallback: 'full',
        execAutoAllowSkills: true,
        alsoAllow: expect.arrayContaining(['exec', 'awareness_perception']),
      }));
    });

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });

  it('existing OpenClaw config keeps current permissions on setup completion', async () => {
    const api = window.electronAPI as any;
    const permissionsUpdate = vi.fn().mockResolvedValue({ success: true });

    api.detectEnvironment = vi.fn().mockResolvedValue({
      platform: 'darwin', arch: 'arm64', home: '/Users/test',
      systemNodeInstalled: true, systemNodeVersion: 'v22.0.0',
      npmInstalled: true, openclawInstalled: true, openclawVersion: '2026.3.23',
      hasExistingConfig: true,
    });
    api.readExistingConfig = vi.fn().mockResolvedValue({
      exists: true, hasProviders: true, providers: ['openai'], primaryModel: 'gpt-4o', hasApiKey: true,
    });
    api.installNodeJs = vi.fn().mockResolvedValue({ success: true, alreadyInstalled: true });
    api.installOpenClaw = vi.fn().mockResolvedValue({ success: true, alreadyInstalled: true });
    api.installPlugin = vi.fn().mockResolvedValue({ success: true });
    api.startDaemon = vi.fn().mockResolvedValue({ success: true });
    api.bootstrap = vi.fn().mockResolvedValue({ success: true });
    api.permissionsUpdate = permissionsUpdate;

    const onComplete = vi.fn();
    await act(async () => {
      render(<SetupWizard onComplete={onComplete} />);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /start/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/cross-device memory/i)).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /next/i }));
    });

    await waitFor(() => {
      expect(screen.getByText(/your ai assistant is ready/i)).toBeInTheDocument();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /get started/i }));
    });

    await waitFor(() => {
      expect(onComplete).toHaveBeenCalledTimes(1);
    });
    expect(permissionsUpdate).not.toHaveBeenCalled();
  });
});
