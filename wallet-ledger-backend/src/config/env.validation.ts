import { plainToInstance } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

enum NodeEnv {
  DEVELOPMENT = 'development',
  TEST = 'test',
  PRODUCTION = 'production',
}

/**
 * Every required env var in one place. If any of these are missing or
 * malformed, the app refuses to start - "it crashed at boot with a clear
 * message" is always better for a financial system than "it started fine
 * and quietly ran with an undefined JWT secret / no webhook verification".
 */
class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.DEVELOPMENT;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @IsNotEmpty()
  DB_SCHEMA!: string;

  // Must be long enough that it isn't practically brute-forceable; 32 chars
  // is a floor, not a target - generate with `openssl rand -hex 32` (64 chars).
  @IsString()
  @MinLength(32, {
    message: 'JWT_ACCESS_SECRET must be at least 32 characters',
  })
  JWT_ACCESS_SECRET!: string;

  @IsString()
  @IsNotEmpty()
  JWT_ACCESS_EXPIRY: string = '15m';

  @IsString()
  @MinLength(32, {
    message: 'PAYMENT_WEBHOOK_SECRET must be at least 32 characters',
  })
  PAYMENT_WEBHOOK_SECRET!: string;

  // Allowed to be empty in local dev (no browser origin can call the API),
  // but must at least be present as a key so the omission is a deliberate
  // choice, not an accident - see the startup warning in main.ts.
  @IsString()
  CORS_ORIGINS: string = '';
}

export function validateEnv(
  config: Record<string, unknown>,
): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
  });

  const errors = validateSync(validated, { skipMissingProperties: false });

  if (errors.length > 0) {
    const messages = errors
      .map((e) => Object.values(e.constraints ?? {}).join(', '))
      .join('\n  - ');
    throw new Error(`Invalid environment configuration:\n  - ${messages}`);
  }

  return validated;
}
