import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { LedgerDirection } from '../../common/types/ledger.enum';
import { bigintTransformer } from '../../common/transformers/bigint.transformer';

/**
 * Append-only. UPDATE/DELETE/TRUNCATE are blocked by DB triggers, and a
 * deferred constraint trigger rejects any transaction whose debits != credits
 * at COMMIT. Only LedgerService should ever insert these.
 */
@Entity('ledger_entries')
@Index(['transactionId', 'walletId', 'direction'], { unique: true })
export class LedgerEntry {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'transaction_id', type: 'uuid' })
  transactionId!: string;

  @Column({ name: 'wallet_id', type: 'uuid' })
  walletId!: string;

  @Column({ type: 'enum', enum: LedgerDirection, enumName: 'ledger_direction' })
  direction!: LedgerDirection;

  // Minor units (cents). Always positive; direction carries the sign.
  @Column({ type: 'bigint', transformer: bigintTransformer })
  amount!: bigint;

  @Column({ type: 'char', length: 3 })
  currency!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
