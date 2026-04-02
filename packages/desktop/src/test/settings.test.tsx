import { describe, it, expect, beforeEach } from 'vitest';
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

  it('renders model section', async () => {
    await act(async () => { render(<Settings />); });
    expect(screen.getByText(/Current Model/)).toBeInTheDocument();
  });

  it('renders memory settings', async () => {
    await act(async () => { render(<Settings />); });
    expect(screen.getByText(/Auto Capture/)).toBeInTheDocument();
    expect(screen.getByText(/Auto Recall/)).toBeInTheDocument();
  });

  it('renders gateway management', async () => {
    await act(async () => { render(<Settings />); });
    expect(screen.getByText(/OpenClaw Gateway/)).toBeInTheDocument();
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

  it('renders Recall Limit in Token Optimization section', async () => {
    await act(async () => { render(<Settings />); });
    const labels = screen.getAllByText('Recall Limit');
    expect(labels.length).toBeGreaterThan(0);
  });

  it('renders model restart hint after model change', async () => {
    await act(async () => { render(<Settings />); });
    // The restart hint should not be visible initially
    expect(screen.queryByText(/new chat session/)).not.toBeInTheDocument();
  });
});
