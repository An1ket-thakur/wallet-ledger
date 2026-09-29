import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';
import {
  TransactionStatus,
  TransactionType,
} from '../../common/types/ledger.enum';

/**
 * A business-level money movement. Its ledger_entries always net to zero.
 * A reversal is a NEW transaction of type REVERSAL pointing at the original;
 * the UNIQUE constraint on reverses_transaction_id means a transaction can
 * only be reversed once.
 */
@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'enum', enum: TransactionType, enumName: 'transaction_type' })
  type!: TransactionType;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    enumName: 'transaction_status',
    default: TransactionStatus.POSTED,
  })
  status!: TransactionStatus;

  @Column({
    name: 'reverses_transaction_id',
    type: 'uuid',
    nullable: true,
    unique: true,
  })
  reversesTransactionId!: string | null;

  @Column({ name: 'initiated_by', type: 'uuid', nullable: true })
  initiatedBy!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
