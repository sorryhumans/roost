import { describe, it, expect } from 'vitest';
import { redact } from './redact.js';

// All fixtures below are REAL-SHAPED but FAKE. Never paste a live secret here.
// They are JOINED AT RUNTIME so secret scanners (GitHub etc.) never see a
// literal token-shaped string in this source — the redactor under test still
// receives exactly the same final values.
const BOT_TOKEN = ['8755576837', 'AAH-fakeBotTokenChars_abcdefghijklmnop12345'].join(':');
const OPENAI_KEY = ['sk', 'proj', 'abcd1234abcd1234abcd1234abcd'].join('-');
const META_TOKEN = ['EAAU', 'abcdef1234567890ABCDEF'].join('');
const WEBHOOK_SECRET = ['whsec', 'abcdef1234567890abcdef1234'].join('_');
const GENERIC_OPAQUE = 'a1b2c3d4e5f6'.repeat(3) + 'a1b2'; // 40 chars
const PHONE = '+48 555 123 760';

describe('redact()', () => {
  it('replaces a bot token with [token] and leaves no token tail', () => {
    const out = redact(`bot=${BOT_TOKEN} done`);
    expect(out).toContain('[token]');
    expect(out).not.toContain(BOT_TOKEN);
    // the distinctive colon+tail must not survive
    expect(out).not.toContain([':AAH-fakeBotTokenChars', 'abcdefghijklmnop12345'].join('_'));
  });

  it('redacts an OpenAI-style key', () => {
    const out = redact(`key ${OPENAI_KEY}`);
    expect(out).toContain('[redacted]');
    expect(out).not.toContain(OPENAI_KEY);
    expect(out).not.toContain('sk-proj-');
  });

  it('redacts a Meta (EAAU) token', () => {
    const out = redact(`meta ${META_TOKEN}`);
    expect(out).toContain('[redacted]');
    expect(out).not.toContain(META_TOKEN);
  });

  it('redacts a webhook secret', () => {
    const out = redact(`hook ${WEBHOOK_SECRET}`);
    expect(out).toContain('[redacted]');
    expect(out).not.toContain(WEBHOOK_SECRET);
  });

  it('redacts a generic high-entropy 40-char string', () => {
    const out = redact(`opaque ${GENERIC_OPAQUE}`);
    expect(out).toContain('[redacted]');
    expect(out).not.toContain(GENERIC_OPAQUE);
  });

  it('masks a phone number keeping only the last 3 digits', () => {
    const out = redact(`call ${PHONE} now`);
    // full 9-digit sequence must not survive in any spacing form
    expect(out).not.toContain(PHONE);
    expect(out).not.toContain('555 123 760');
    expect(out).not.toContain('48555123760');
    // last 3 digits preserved, prefixed by a bullet run
    expect(out).toContain('•760');
    expect(out).toMatch(/\+•+760/);
  });

  it('leaves a benign label untouched', () => {
    expect(redact('Editing a file')).toBe('Editing a file');
    expect(redact('Running a command')).toBe('Running a command');
    expect(redact('Replying on Telegram')).toBe('Replying on Telegram');
  });

  it('returns empty string unchanged and never throws on falsy input', () => {
    expect(redact('')).toBe('');
    // undefined-ish guard: function must not throw
    expect(() => redact(undefined as unknown as string)).not.toThrow();
    expect(redact(undefined as unknown as string)).toBe(undefined);
    expect(() => redact(null as unknown as string)).not.toThrow();
    expect(redact(null as unknown as string)).toBe(null as unknown as string);
  });

  // HEADLINE SAFETY TEST (SAFE-02): one combined fixture containing every secret
  // shape + PII. After redaction, NONE of the raw secret substrings may survive.
  it('HEADLINE: no raw secret or full phone survives a combined fixture (SAFE-02)', () => {
    const secrets = [
      BOT_TOKEN,
      OPENAI_KEY,
      META_TOKEN,
      WEBHOOK_SECRET,
      GENERIC_OPAQUE,
      PHONE,
    ];
    const fixture = [
      `tmux footer: token=${BOT_TOKEN}`,
      `openai ${OPENAI_KEY}`,
      `meta ${META_TOKEN}`,
      `stripe ${WEBHOOK_SECRET}`,
      `session ${GENERIC_OPAQUE}`,
      `lead phone ${PHONE} captured`,
    ].join(' | ');

    const out = redact(fixture);

    for (const secret of secrets) {
      expect(out).not.toContain(secret);
    }
    // also assert the distinctive inner pieces are gone
    expect(out).not.toContain('sk-proj-');
    expect(out).not.toContain('whsec_');
    expect(out).not.toContain('EAAUabcdef');
    expect(out).not.toContain('555 123 760');
  });
});
