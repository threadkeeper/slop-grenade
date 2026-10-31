/** Android Gmail reports use a hashed account ID and a provider message ID. */
export function isGmailMessageId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}:[A-Za-z0-9_-]{1,128}$/.test(value);
}
