import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Verifies an HMAC-SHA256 signature over the RAW request body. Must run
 * against the raw bytes, not the parsed/re-serialized JSON - re-serializing
 * can change key order or whitespace and silently invalidate a valid
 * signature (or worse, "fix" a tampered payload by accident).
 */
export function verifyHmacSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string,
): boolean {
  if (!signatureHeader) return false;

  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  const givenBuf = Buffer.from(signatureHeader, 'hex');

  // Different lengths would throw inside timingSafeEqual, and different
  // lengths are also not a secret worth timing-leaking, so short-circuit
  // is fine here - the real defense is on the equal-length comparison.
  if (expectedBuf.length !== givenBuf.length) return false;

  return timingSafeEqual(expectedBuf, givenBuf);
}
