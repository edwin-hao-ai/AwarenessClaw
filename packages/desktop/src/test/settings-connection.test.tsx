import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import Settings from '../pages/Settings';

describe('Settings Connection Test', () => {
  it('renders gateway status', async () => {
    await act(async () => { render(<Settings />); });
    // Gateway section should show status
    expect(screen.getByText(/OpenClaw Gateway/)).toBeInTheDocument();
  });

  it('renders model switch button', async () => {
    await act(async () => { render(<Settings />); });
    expect(screen.getByText(/切换模型/)).toBeInTheDocument();
  });

  it('renders version info', async () => {
    await act(async () => { render(<Settings />); });
    expect(screen.getByText(/AwarenessClaw v/)).toBeInTheDocument();
  });
});
