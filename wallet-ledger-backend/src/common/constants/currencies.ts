/**
 * Currencies wallets can be created in. Every currency listed here MUST have
 * a matching system wallet (system_code = 'PLATFORM_CASH_<CUR>') seeded in a
 * migration, because deposits/withdrawals need that counterparty.
 */
export const SUPPORTED_CURRENCIES = ['USD', 'INR', 'EUR'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
