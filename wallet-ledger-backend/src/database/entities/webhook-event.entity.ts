import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Dedup table for inbound webhooks. Distinct from idempotency_keys: that
 * table is keyed by (our user, client-supplied key) for API callers; this one
 * is keyed by (provider, provider's own event id) since webhooks have no
 * concept of "our user" until after we've looked up the wallet, and the
 * provider - not our client - controls the id and can redeliver at will.
 */
@Entity('webhook_events')
export class WebhookEvent {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'provider', type: 'varchar', length: 64 })
  provider!: string;

  // The provider's event id, e.g. Stripe's evt_xxx. Unique per provider so
  // redelivery (at-least-once webhook delivery is standard) is a no-op.
  @Column({ name: 'provider_event_id', type: 'varchar', length: 255 })
  providerEventId!: string;

  @Column({ name: 'transaction_id', type: 'uuid', nullable: true })
  transactionId!: string | null;

  @CreateDateColumn({ name: 'received_at', type: 'timestamptz' })
  receivedAt!: Date;
}
