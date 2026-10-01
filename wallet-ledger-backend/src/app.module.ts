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
import { RefundsModule } from './refunds/refunds.module';
import { ReconciliationModule } from './reconciliation/reconciliation.module';
import { SupportModule } from './support/support.module';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('DATABASE_URL'),
        extra: {
          options: `-c search_path=${config.get<string>('DB_SCHEMA')}`,
        },
        autoLoadEntities: true,
        synchronize: false,
        logging: true,
      }),
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 100 }]),
    AuthModule,
    UsersModule,
    WalletsModule,
    TransactionsModule,
    LedgerModule,
    IdempotencyModule,
    WebhooksModule,
    RefundsModule,
    ReconciliationModule,
    SupportModule,
  ],
  providers: [
    // Order: Throttler first (reject abusive traffic before it's even
    // authenticated), then JwtAuthGuard (populates req.user), then RolesGuard.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
