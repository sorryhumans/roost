// Defense-in-depth secret/PII scrubber (SAFE-02).
//
// Layer 1 (structural, in Plan 02's readers): the collector converts transcript
// events to short labels and DISCARDS raw content. Layer 2 is this function,
// applied to every string that still passes through to the client (e.g. tmux
// footer text, metric detail fields). redact() is the last gate before output.
//
// It is a PURE function (string in, string out), tolerates falsy input without
// throwing, and never mutates global state. Substitution order matters: the most
// specific patterns run first so a phone-shaped substring inside a token is not
// pre-mangled, and the phone mask runs last (the token's colon+digits must be
// handled before the phone rule could touch token internals).

/** Bot tokens, e.g. `8755576837:AAH...` → labelled `[token]` (run first). */
const BOT_TOKEN = /\d{8,10}:[A-Za-z0-9_-]{30,}/g;

/** OpenAI-style keys, e.g. `sk-proj-...`. */
const OPENAI_KEY = /sk-[A-Za-z0-9-]{20,}/g;

/** Meta long-lived tokens, e.g. `EAAU...`. */
const META_TOKEN = /EAAU[A-Za-z0-9]+/g;

/** Stripe-style webhook secrets, e.g. `whsec_...`. */
const WEBHOOK_SECRET = /whsec_[A-Za-z0-9]+/g;

/** Generic high-entropy / opaque strings of 32+ chars (catch-all). */
const GENERIC_HIGH_ENTROPY = /[A-Za-z0-9_\-]{32,}/g;

/** Phone numbers (PII): an optional `+`, a digit, then 7+ of digit/space/()-.\ then a digit. */
const PHONE = /\+?\d[\d\s().-]{7,}\d/g;

/** Fixed bullet prefix used when masking a phone number (keeps only last 3 digits). */
const PHONE_BULLETS = '•'.repeat(5);

/**
 * Scrub secrets and PII from a single string before it leaves the server.
 *
 * Falsy input (empty string, null, undefined) is returned unchanged so callers
 * can pass through optional fields without guarding. Never throws.
 */
export function redact(s: string): string {
  if (!s) return s;

  let out = s;

  // Order: most-specific secret shapes first, generic catch-all next, phone last.
  out = out.replace(BOT_TOKEN, '[token]');
  out = out.replace(OPENAI_KEY, '[redacted]');
  out = out.replace(META_TOKEN, '[redacted]');
  out = out.replace(WEBHOOK_SECRET, '[redacted]');
  out = out.replace(GENERIC_HIGH_ENTROPY, '[redacted]');

  // Phone mask LAST: keep the trailing 3 digits, replace everything before with
  // a fixed bullet run. Use a replacer so we can extract the last 3 digits.
  out = out.replace(PHONE, (match) => {
    const digits = match.replace(/\D/g, '');
    const last3 = digits.slice(-3);
    return `+${PHONE_BULLETS}${last3}`;
  });

  return out;
}
