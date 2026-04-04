import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { useI18n } from '../lib/i18n';

function I18nProbe({ keyName }: { keyName: string }) {
  const { t } = useI18n();
  return <span data-testid="probe">{t(keyName)}</span>;
}

describe('i18n regression keys', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('contains channel plugin repair status key for en and zh', () => {
    localStorage.setItem('awareness-claw-config', JSON.stringify({ language: 'en' }));
    const { unmount } = render(<I18nProbe keyName="channels.status.repairingPlugin" />);
    expect(screen.getByTestId('probe').textContent).not.toBe('channels.status.repairingPlugin');

    unmount();
    localStorage.setItem('awareness-claw-config', JSON.stringify({ language: 'zh' }));
    render(<I18nProbe keyName="channels.status.repairingPlugin" />);
    expect(screen.getByTestId('probe').textContent).not.toBe('channels.status.repairingPlugin');
  });

  it('contains Telegram-specific health action label for en and zh', () => {
    localStorage.setItem('awareness-claw-config', JSON.stringify({ language: 'en' }));
    const { unmount } = render(<I18nProbe keyName="settings.health.fixTelegram" />);
    expect(screen.getByTestId('probe').textContent).not.toBe('settings.health.fixTelegram');

    unmount();
    localStorage.setItem('awareness-claw-config', JSON.stringify({ language: 'zh' }));
    render(<I18nProbe keyName="settings.health.fixTelegram" />);
    expect(screen.getByTestId('probe').textContent).not.toBe('settings.health.fixTelegram');
  });
});
