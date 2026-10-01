import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Signs/verifies over `${timestamp}.${rawBody}`, not the body alone - this is
 * what makes replay protection possible. Signing the body alone means a
 * captured, previously-valid (timestamp, signature, body) triple stays valid
 * forever; binding the timestamp into the signed payload means an attacker
 * can't reuse an old signature with a new timestamp (the signature wouldn't
 * match) OR replay the exact original request past its freshness window
 * (checked separately in isTimestampFresh).
 */
export function buildSignedPayload(timestamp: string, rawBody: Buffer): string {
  return `${timestamp}.${rawBody.toString('utf8')}`;
}

export function verifyHmacSignature(
  signedPayload: string,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;

  const expected = createHmac('sha256', secret)
    .update(signedPayload)
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const givenBuf = Buffer.from(signatureHeader, 'hex');

  if (expectedBuf.length !== givenBuf.length) return false;
  return timingSafeEqual(expectedBuf, givenBuf);
}

/**
 * Rejects timestamps too far in the past (a captured request being replayed
 * well after the fact) or too far in the future (clock manipulation /
 * malformed input). Tolerance is deliberately asymmetric and generous on
 * neither side - 5 minutes matches Stripe's own default tolerance, a
 * reasonable balance between rejecting stale replays and tolerating normal
 * clock drift / network delay between the provider and this server.
 */
export function isTimestampFresh(
  timestampHeader: string | undefined,
  toleranceSeconds = 300,
): boolean {
  if (!timestampHeader) return false;

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) return false;

  const nowSeconds = Math.floor(Date.now() / 1000);
  const diff = Math.abs(nowSeconds - timestamp);

  return diff <= toleranceSeconds;
}
