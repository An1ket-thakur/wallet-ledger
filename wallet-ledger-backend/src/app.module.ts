import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersModule } from './users/users.module';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { WalletsModule } from './wallet/wallet.module';
import { LedgerModule } from './ledger/ledger.module';
import { TransactionsModule } from './transactions/transactions.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        return {
          type: 'postgres',
          username: config.get<string>('DB_USER'),
          password: config.get<string>('DB_PASSWORD'),
          port: parseInt(config.get<string>('DB_PORT') || '5432'),
          schema: config.get<string>('DB_SCHEMA'),
          database: config.get<string>('DB_NAME'),
          host: config.get<string>('DB_HOST'),
          autoLoadEntities: true,
          synchronize: false,
        };
      },
    }),
    AuthModule,
    UsersModule,
    WalletsModule,
    TransactionsModule,
    LedgerModule,
    IdempotencyModule,
    WebhooksModule,
  ],
  providers: [
    // Order matters: JwtAuthGuard populates req.user, RolesGuard then reads it.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
