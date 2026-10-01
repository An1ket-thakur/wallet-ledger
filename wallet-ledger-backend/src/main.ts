import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { RawBodyMiddleware } from './common/middleware/raw-body.middleware';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import compression from 'compression';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { config as loadEnv } from 'dotenv';
import { validateEnv } from './config/env.validation';

const logger = new Logger('Bootstrap');

// Runs BEFORE anything else, including NestFactory.create() - this is what
// guarantees env validation happens before TypeOrmModule (or any other
// module) gets a chance to touch process.env. Nest's own module
// instantiation order isn't a safe place to rely on for this: ConfigModule's
// validate() runs as part of the DI graph, which is a step AFTER module
// imports are already being processed, so a module that reads env vars
// directly (like TypeOrmModule.forRoot via data-source.ts) could act on bad
// config before ConfigModule ever gets to throw.
loadEnv();
try {
  validateEnv(process.env);
} catch (err) {
  logger.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // --- Security headers ---
  // Sets X-Content-Type-Options, X-Frame-Options, removes X-Powered-By, etc.
  // contentSecurityPolicy disabled: this is a pure JSON API with no HTML
  // views to protect with a CSP - leaving it on would add a header with no
  // benefit and occasionally break Swagger/docs UIs if one gets added later.
  app.use(helmet({ contentSecurityPolicy: false }));

  app.use(compression());

  // --- CORS: explicit allowlist, not a wildcard ---
  // A wildcard ('*') combined with credentials (cookies/auth headers) is
  // actively rejected by browsers anyway, but more importantly it's the
  // wrong default for an API that issues bearer tokens meant for specific
  // known frontends, not arbitrary origins.
  const corsOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (corsOrigins.length === 0) {
    logger.warn(
      'CORS_ORIGINS is not set - no browser origin will be allowed to call this API',
    );
  }

  app.enableCors({
    origin: corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'],
    exposedHeaders: ['Idempotent-Replay'],
  });

  // --- Body size limits ---
  // Prevents a client (or an attacker) from sending an oversized JSON payload
  // to tie up memory/CPU during parsing. 1mb is generous for anything this
  // API actually needs (small DTOs); tighten further if you know your real
  // max payload size.
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: true });

  // Mounted AFTER useBodyParser config above but still registered as
  // middleware before Nest's internal parser actually runs per-request -
  // this route fully owns its own body parsing (see RawBodyMiddleware).
  app.use(
    '/api/v1/webhooks/payment-provider',
    new RawBodyMiddleware().use.bind(new RawBodyMiddleware()),
  );

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Ensures no unhandled exception ever leaks a raw stack trace or internal
  // error message to the client, regardless of where it originates.
  app.useGlobalFilters(new AllExceptionsFilter());

  app.setGlobalPrefix('api/v1');

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  logger.log(`Listening on port ${port}`);
}
bootstrap();
