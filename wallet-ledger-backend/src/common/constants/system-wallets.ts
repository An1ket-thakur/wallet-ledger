/**
 * Maps a currency to its platform counterparty wallet's system_code.
 * Every entry here must have a matching row seeded in a migration
 * (see CreateLedgerSchema1790500000000 for USD).
 */
export const PLATFORM_CASH_SYSTEM_CODE: Record<string, string> = {
  USD: 'PLATFORM_CASH_USD',
  EUR: 'PLATFORM_CASH_EUR',
  INR: 'PLATFORM_CASH_INR',
};
