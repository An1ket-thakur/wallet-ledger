import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { RawBodyMiddleware } from './common/middleware/raw-body.middleware';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Mounted BEFORE the global body-parser (Nest's default body parsing is
  // still applied afterward via ValidationPipe / class-validator on the DTO -
  // this middleware only captures the raw bytes onto req.rawBody for HMAC
  // verification, it doesn't replace JSON parsing).
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
  app.setGlobalPrefix('api/v1');
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
