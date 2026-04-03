import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import Settings from '../pages/Settings';

describe('Settings Connection Test', () => {
  it('renders gateway status', async () => {
    await act(async () => { render(<Settings />); });
    // Gateway section should show status
    expect(screen.getByText(/OpenClaw Gateway/)).toBeInTheDocument();
  });

  it('renders token optimization section', async () => {
    await act(async () => { render(<Settings />); });
    expect(screen.getByText(/Token Optimization/)).toBeInTheDocument();
  });

  it('renders version info', async () => {
    await act(async () => { render(<Settings />); });
    expect(screen.getByText('AwarenessClaw')).toBeInTheDocument();
  });
});
