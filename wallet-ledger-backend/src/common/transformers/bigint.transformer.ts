import { ValueTransformer } from 'typeorm';

export const bigintTransformer: ValueTransformer = {
  to: (value?: bigint | number | null) =>
    value === undefined || value === null ? value : value.toString(),
  from: (value?: string | null) =>
    value === undefined || value === null ? value : BigInt(value),
};
