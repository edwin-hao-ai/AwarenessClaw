import { describe, it, expect } from 'vitest';
import {
  getAllChannels, getChannel, getChannelByOpenclawId,
  toOpenclawId, toFrontendId, isOneClick, hasBrandIcon,
  buildCLIFlags, mergeCatalog, mergeChannelOptions,
  getBuiltinChannels, serializeRegistry, loadFromSerialized,
} from '../lib/channel-registry';

describe('Channel Registry', () => {
  describe('Builtin channels', () => {
    it('has only 2 builtins: local + wechat', () => {
      const builtins = getBuiltinChannels();
      expect(builtins).toHaveLength(2);
      expect(builtins.map(c => c.id).sort()).toEqual(['local', 'wechat']);
    });

    it('only WeChat uses json-direct', () => {
      const jsonDirect = getBuiltinChannels().filter(c => c.saveStrategy === 'json-direct');
      expect(jsonDirect).toHaveLength(1);
      expect(jsonDirect[0].id).toBe('wechat');
    });

    it('wechat has third-party plugin package', () => {
      const wc = getChannel('wechat');
      expect(wc!.pluginPackage).toBe('@tencent-weixin/openclaw-weixin');
    });
  });

  describe('ID mapping', () => {
    it('wechat ↔ openclaw-weixin', () => {
      expect(toOpenclawId('wechat')).toBe('openclaw-weixin');
      expect(toFrontendId('openclaw-weixin')).toBe('wechat');
    });

    it('unknown returns itself', () => {
      expect(toOpenclawId('xxx')).toBe('xxx');
      expect(toFrontendId('xxx')).toBe('xxx');
    });
  });

  describe('Dynamic discovery — mergeCatalog', () => {
    it('adds channels with known overrides applied', () => {
      mergeCatalog([
        { name: '@openclaw/telegram', openclaw: { channel: { id: 'telegram', label: 'Telegram' }, install: { npmSpec: '@openclaw/telegram' } } },
        { name: '@openclaw/whatsapp', openclaw: { channel: { id: 'whatsapp', label: 'WhatsApp' }, install: { npmSpec: '@openclaw/whatsapp' } } },
        { name: '@openclaw/slack', openclaw: { channel: { id: 'slack', label: 'Slack' }, install: { npmSpec: '@openclaw/slack' } } },
        { name: '@openclaw/nostr', openclaw: { channel: { id: 'nostr', label: 'Nostr' }, install: { npmSpec: '@openclaw/nostr' } } },
      ]);

      // Telegram: single token, brand SVG
      const tg = getChannel('telegram');
      expect(tg).toBeDefined();
      expect(tg!.connectionType).toBe('token');
      expect(tg!.configFields).toHaveLength(1);
      expect(tg!.configFields[0].cliFlag).toBe('--token');
      expect(tg!.iconType).toBe('svg');
      expect(tg!.color).toBe('#26A5E4');

      // WhatsApp: one-click
      const wa = getChannel('whatsapp');
      expect(wa!.connectionType).toBe('one-click');
      expect(wa!.configFields).toHaveLength(0);
      expect(wa!.setupFlow).toBe('qr-login');

      // Slack: multi-field with 2 fields
      const sl = getChannel('slack');
      expect(sl!.connectionType).toBe('multi-field');
      expect(sl!.configFields).toHaveLength(2);
      expect(sl!.configFields[0].cliFlag).toBe('--bot-token');
      expect(sl!.configFields[1].cliFlag).toBe('--app-token');

      // Nostr: multi-field with private key
      const ns = getChannel('nostr');
      expect(ns!.connectionType).toBe('multi-field');
      expect(ns!.configFields[0].cliFlag).toBe('--private-key');
    });

    it('does NOT override builtins (wechat)', () => {
      mergeCatalog([
        { name: 'fake', openclaw: { channel: { id: 'wechat', label: 'OVERRIDE' } } },
      ]);
      expect(getChannel('wechat')!.label).toBe('WeChat');
      expect(getChannel('wechat')!.saveStrategy).toBe('json-direct');
    });
  });

  describe('Dynamic discovery — mergeChannelOptions', () => {
    it('adds channels from CLI metadata', () => {
      mergeChannelOptions(['twitch', 'msteams', 'qqbot']);
      const tw = getChannel('twitch');
      expect(tw).toBeDefined();
      expect(tw!.connectionType).toBe('token');
      // twitch is not in CLI enum, so it defaults to json-direct
      expect(tw!.saveStrategy).toBe('json-direct');
    });

    it('skips builtin channels', () => {
      const before = getAllChannels().length;
      mergeChannelOptions(['wechat']); // builtin, should be skipped
      expect(getAllChannels().length).toBe(before);
    });
  });

  describe('One-click detection', () => {
    it('wechat is one-click (builtin)', () => { expect(isOneClick('wechat')).toBe(true); });
  });

  describe('buildCLIFlags', () => {
    it('single token', () => {
      // Need to trigger catalog merge first so telegram exists
      mergeCatalog([{ name: '@openclaw/telegram', openclaw: { channel: { id: 'telegram', label: 'Telegram' } } }]);
      const ch = getChannel('telegram')!;
      expect(buildCLIFlags(ch, { token: 'abc' })).toBe('--token "abc"');
    });

    it('multi-field (slack)', () => {
      mergeCatalog([{ name: '@openclaw/slack', openclaw: { channel: { id: 'slack', label: 'Slack' } } }]);
      const ch = getChannel('slack')!;
      expect(buildCLIFlags(ch, { botToken: 'xoxb', appToken: 'xapp' })).toBe('--bot-token "xoxb" --app-token "xapp"');
    });

    it('escapes quotes', () => {
      // Ensure telegram is in registry (may have been added by earlier test)
      mergeCatalog([{ name: '@openclaw/telegram', openclaw: { channel: { id: 'telegram', label: 'Telegram' } } }]);
      const ch = getChannel('telegram')!;
      expect(buildCLIFlags(ch, { token: 'a"b' })).toBe('--token "a\\"b"');
    });
  });

  describe('Serialization', () => {
    it('round-trips correctly', () => {
      const serialized = serializeRegistry();
      expect(serialized.length).toBeGreaterThanOrEqual(2);
      loadFromSerialized(serialized);
      expect(getChannel('wechat')).toBeDefined();
    });
  });

  describe('Known overrides coverage', () => {
    it('matrix has 3 config fields', () => {
      mergeCatalog([{ name: '@openclaw/matrix', openclaw: { channel: { id: 'matrix', label: 'Matrix' } } }]);
      const m = getChannel('matrix')!;
      expect(m.configFields).toHaveLength(3);
      expect(m.configFields.map(f => f.cliFlag)).toEqual(['--homeserver', '--user-id', '--password']);
    });

    it('googlechat has webhook URL field', () => {
      mergeCatalog([{ name: '@openclaw/googlechat', openclaw: { channel: { id: 'googlechat', label: 'Google Chat' } } }]);
      const g = getChannel('googlechat')!;
      expect(g.configFields).toHaveLength(1);
      expect(g.configFields[0].cliFlag).toBe('--webhook-url');
    });

    it('signal is one-click with add-then-login flow', () => {
      mergeCatalog([{ name: '@openclaw/signal', openclaw: { channel: { id: 'signal', label: 'Signal' } } }]);
      expect(isOneClick('signal')).toBe(true);
      expect(getChannel('signal')!.setupFlow).toBe('add-then-login');
    });

    it('imessage is one-click with add-only flow', () => {
      mergeCatalog([{ name: '@openclaw/imessage', openclaw: { channel: { id: 'imessage', label: 'iMessage' } } }]);
      expect(isOneClick('imessage')).toBe(true);
      expect(getChannel('imessage')!.setupFlow).toBe('add-only');
    });

    it('tlon has 3 config fields', () => {
      mergeCatalog([{ name: '@openclaw/tlon', openclaw: { channel: { id: 'tlon', label: 'Tlon' } } }]);
      const t = getChannel('tlon')!;
      expect(t.configFields).toHaveLength(3);
      expect(t.configFields.map(f => f.cliFlag)).toEqual(['--ship', '--url', '--code']);
    });
  });
});
