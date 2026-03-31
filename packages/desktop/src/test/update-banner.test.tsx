import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import UpdateBanner from '../components/UpdateBanner';
import Dashboard from '../pages/Dashboard';

describe('UpdateBanner', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('awareness-claw-config', JSON.stringify({ language: 'en' }));
  });

  it('renders nothing when no updates', async () => {
    const { container } = await act(async () => render(<UpdateBanner />));
    await waitFor(() => {
      expect(container.textContent).toBe('');
    });
  });

  it('shows modal when updates are available', async () => {
    const origApi = (window as any).electronAPI;
    (window as any).electronAPI = {
      ...origApi,
      checkUpdates: () => Promise.resolve({
        updates: [{ component: 'openclaw', label: 'OpenClaw', currentVersion: '1.0.0', latestVersion: '1.1.0' }],
      }),
    };

    await act(async () => { render(<UpdateBanner />); });
    await waitFor(() => {
      expect(screen.getByText('Updates Available')).toBeInTheDocument();
      expect(screen.getByText('OpenClaw')).toBeInTheDocument();
    });

    (window as any).electronAPI = origApi;
  });

  it('dismiss works via session storage', async () => {
    const origApi = (window as any).electronAPI;
    (window as any).electronAPI = {
      ...origApi,
      checkUpdates: () => Promise.resolve({
        updates: [{ component: 'openclaw', label: 'OpenClaw', currentVersion: '1.0.0', latestVersion: '1.1.0' }],
      }),
    };

    await act(async () => { render(<UpdateBanner />); });
    await waitFor(() => { expect(screen.getByText('Updates Available')).toBeInTheDocument(); });
    fireEvent.click(screen.getByText('Remind me later'));
    expect(sessionStorage.getItem('awareness-claw-update-dismissed')).toBe('true');

    (window as any).electronAPI = origApi;
  });

  it('never remind stores to localStorage', async () => {
    const origApi = (window as any).electronAPI;
    (window as any).electronAPI = {
      ...origApi,
      checkUpdates: () => Promise.resolve({
        updates: [{ component: 'plugin', label: 'Plugin', currentVersion: '0.4.0', latestVersion: '0.5.0' }],
      }),
    };

    await act(async () => { render(<UpdateBanner />); });
    await waitFor(() => { expect(screen.getByText('Updates Available')).toBeInTheDocument(); });
    fireEvent.click(screen.getByText(/Never remind/));
    expect(localStorage.getItem('awareness-claw-update-never')).toBe('true');

    (window as any).electronAPI = origApi;
  });

  it('upgrade button triggers upgradeComponent', async () => {
    const upgradeFn = vi.fn(() => Promise.resolve({ success: true }));
    const origApi = (window as any).electronAPI;
    (window as any).electronAPI = {
      ...origApi,
      checkUpdates: () => Promise.resolve({
        updates: [{ component: 'openclaw', label: 'OpenClaw', currentVersion: '1.0.0', latestVersion: '1.1.0' }],
      }),
      upgradeComponent: upgradeFn,
    };

    await act(async () => { render(<UpdateBanner />); });
    await waitFor(() => { expect(screen.getByText('Upgrade Now')).toBeInTheDocument(); });
    await act(async () => { fireEvent.click(screen.getByText('Upgrade Now')); });
    await waitFor(() => { expect(upgradeFn).toHaveBeenCalledWith('openclaw'); });

    (window as any).electronAPI = origApi;
  });
});

describe('Dashboard with update banner', () => {
  let origApi: any;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('awareness-claw-config', JSON.stringify({ language: 'en' }));
    origApi = (window as any).electronAPI;
  });

  afterEach(() => {
    (window as any).electronAPI = origApi;
  });

  it('shows upgrade banner when checkUpdates returns updates alongside Dashboard', async () => {
    (window as any).electronAPI = {
      ...origApi,
      checkUpdates: vi.fn(() => Promise.resolve({
        updates: [{ component: 'openclaw', label: 'OpenClaw', currentVersion: '3.13', latestVersion: '3.28' }],
      })),
    };

    await act(async () => {
      render(
        <>
          <UpdateBanner />
          <Dashboard />
        </>
      );
    });

    // Verify the upgrade modal appears with version info
    await waitFor(() => {
      expect(screen.getByText('Updates Available')).toBeInTheDocument();
    });
    expect(screen.getByText('OpenClaw')).toBeInTheDocument();
    expect(screen.getByText('Upgrade Now')).toBeInTheDocument();
    // Version numbers are rendered inside the same row
    expect(screen.getByText(/3\.13/)).toBeInTheDocument();
    expect(screen.getByText(/3\.28/)).toBeInTheDocument();
  });

  it('Dashboard still renders chat UI behind the update modal', async () => {
    (window as any).electronAPI = {
      ...origApi,
      checkUpdates: vi.fn(() => Promise.resolve({
        updates: [{ component: 'openclaw', label: 'OpenClaw', currentVersion: '3.13', latestVersion: '3.28' }],
      })),
    };

    await act(async () => {
      render(
        <>
          <UpdateBanner />
          <Dashboard />
        </>
      );
    });

    // Update modal is visible
    await waitFor(() => {
      expect(screen.getByText('Updates Available')).toBeInTheDocument();
    });

    // Dashboard content is still in the DOM behind the modal (logo img, not visible text)
    expect(screen.getByAltText('AwarenessClaw')).toBeInTheDocument();
  });

  it('checkUpdates mock is called exactly once on mount', async () => {
    const checkFn = vi.fn(() => Promise.resolve({
      updates: [{ component: 'openclaw', label: 'OpenClaw', currentVersion: '3.13', latestVersion: '3.28' }],
    }));
    (window as any).electronAPI = { ...origApi, checkUpdates: checkFn };

    await act(async () => {
      render(
        <>
          <UpdateBanner />
          <Dashboard />
        </>
      );
    });

    await waitFor(() => {
      expect(checkFn).toHaveBeenCalledTimes(1);
    });
  });
});
