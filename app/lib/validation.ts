// Fields are submitted programmatically via fetcher.submit rather than a
// native form submit, so the browser's built-in <input type="email">
// constraint validation never runs — this has to be checked explicitly,
// both client-side (for the disabled-button gating) and server-side (in
// case the client check was bypassed).
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}
