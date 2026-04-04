import { createRef } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import OpenClawConfigSectionForm from '../components/OpenClawConfigSectionForm';
import { ChannelConversationView } from '../components/dashboard/ChannelConversationView';
import KnowledgeGraph from '../components/memory/KnowledgeGraph';
import { useI18n } from '../lib/i18n';
import type { DynamicConfigSection } from '../lib/openclaw-capabilities';

function I18nProbe({ keyName }: { keyName: string }) {
  const { t } = useI18n();
  return <span data-testid="probe">{t(keyName)}</span>;
}

function setLanguage(language: 'en' | 'zh') {
  localStorage.setItem('awareness-claw-config', JSON.stringify({ language }));
}

describe('i18n regression keys', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('contains channel plugin repair status key for en and zh', () => {
    setLanguage('en');
    const { unmount } = render(<I18nProbe keyName="channels.status.repairingPlugin" />);
    expect(screen.getByTestId('probe').textContent).not.toBe('channels.status.repairingPlugin');

    unmount();
    setLanguage('zh');
    render(<I18nProbe keyName="channels.status.repairingPlugin" />);
    expect(screen.getByTestId('probe').textContent).not.toBe('channels.status.repairingPlugin');
  });

  it('contains Telegram-specific health action label for en and zh', () => {
    setLanguage('en');
    const { unmount } = render(<I18nProbe keyName="settings.health.fixTelegram" />);
    expect(screen.getByTestId('probe').textContent).not.toBe('settings.health.fixTelegram');

    unmount();
    setLanguage('zh');
    render(<I18nProbe keyName="settings.health.fixTelegram" />);
    expect(screen.getByTestId('probe').textContent).not.toBe('settings.health.fixTelegram');
  });

  it('contains new fallback labels for en and zh', () => {
    setLanguage('en');
    const { unmount } = render(<I18nProbe keyName="chat.memoryWarningPrefix" />);
    expect(screen.getByTestId('probe').textContent).toBe('Memory save failed:');

    unmount();
    setLanguage('zh');
    render(<I18nProbe keyName="settings.hooks" />);
    expect(screen.getByTestId('probe').textContent).toBe('钩子');
  });

  it('renders channel conversation empty state in zh', () => {
    setLanguage('zh');
    render(
      <ChannelConversationView
        activeChannelKey="telegram:session-1"
        channelSessions={[{ sessionKey: 'telegram:session-1', channel: 'telegram', displayName: 'Alice' }]}
        channelLoading={false}
        channelMessages={[]}
        channelReplyText=""
        channelReplying={false}
        messagesEndRef={createRef<HTMLDivElement>()}
        onBack={() => {}}
        onReplyTextChange={() => {}}
        onReplySubmit={() => {}}
      />,
    );

    expect(screen.getByText('还没有消息')).toBeTruthy();
    expect(screen.getByText('发送一条消息来开始对话')).toBeTruthy();
    expect(screen.getByPlaceholderText('回复这个频道...')).toBeTruthy();
  });

  it('renders knowledge graph empty state in zh', () => {
    setLanguage('zh');
    render(<KnowledgeGraph cards={[]} events={[]} width={480} height={320} />);

    expect(screen.getByText('还没有可视化的知识卡片')).toBeTruthy();
    expect(screen.getByText('当 AI 从你的对话中学习后，卡片会出现在这里')).toBeTruthy();
  });

  it('renders dynamic web config labels in zh', () => {
    setLanguage('zh');
    const sections: DynamicConfigSection[] = [
      {
        key: 'search',
        title: 'Web Search',
        description: 'Most users only need to pick a search provider and add a credential if that provider requires one.',
        defaultExpanded: true,
        fields: [
          {
            key: 'search-provider',
            path: 'tools.web.search.provider',
            label: 'Search provider',
            description: 'Choose the provider OpenClaw uses for web search.',
            type: 'select',
            options: [{ value: 'duckduckgo', label: 'DuckDuckGo' }],
            defaultValue: 'duckduckgo',
          },
        ],
      },
    ];

    render(<OpenClawConfigSectionForm sections={sections} values={{}} onChange={() => {}} />);

    expect(screen.getByText('网页搜索')).toBeTruthy();
    expect(screen.getByText('搜索 provider')).toBeTruthy();
    expect(screen.getByText('选择 OpenClaw 进行网页搜索时使用的 provider。')).toBeTruthy();
  });
});
