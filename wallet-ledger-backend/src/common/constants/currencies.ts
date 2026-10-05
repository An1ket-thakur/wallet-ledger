export const SUPPORTED_CURRENCIES = ['USD', 'INR', 'EUR'] as const;
export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];
