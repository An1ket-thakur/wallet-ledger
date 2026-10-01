import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * Append-only audit trail of every privileged (Admin/Support) action that
 * changes state or exposes sensitive data. Distinct from the ledger itself:
 * a refund already produces its own REVERSAL transaction as the financial
 * record of WHAT happened; this table records WHO did it, WHEN, and FROM
 * WHERE - the accountability record, not the money record.
 */
@Entity('admin_actions')
export class AdminAction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'actor_user_id', type: 'uuid' })
  actorUserId!: string;

  @Column({ name: 'actor_role', type: 'varchar', length: 16 })
  actorRole!: string;

  // e.g. 'REFUND_ISSUED', 'USER_DISABLED', 'USER_ENABLED', 'RECONCILIATION_MANUAL_RUN'
  @Index()
  @Column({ type: 'varchar', length: 64 })
  action!: string;

  // What the action was performed on - a transaction id, a user id, etc.
  // Nullable because some actions (e.g. a manual reconciliation trigger)
  // don't target a specific resource.
  @Column({ name: 'target_type', type: 'varchar', length: 32, nullable: true })
  targetType!: string | null;

  @Column({ name: 'target_id', type: 'uuid', nullable: true })
  targetId!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  details!: Record<string, unknown> | null;

  @Column({ name: 'ip_address', type: 'varchar', length: 64, nullable: true })
  ipAddress!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
