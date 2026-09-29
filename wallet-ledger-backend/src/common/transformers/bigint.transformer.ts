import { ValueTransformer } from 'typeorm';

/**
 * Money is stored as bigint minor units (cents). The `pg` driver returns
 * bigint columns as strings, so without this you'd get "100" + "50" = "10050".
 * Entity property type is the native `bigint`.
 */
export const bigintTransformer: ValueTransformer = {
  to: (value?: bigint | number | null) =>
    value === undefined || value === null ? value : value.toString(),
  from: (value?: string | null) =>
    value === undefined || value === null ? value : BigInt(value),
};
