import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { WalletStatus } from '../../common/types/ledger.enum';
import { User } from './users.entity';

/**
 * NOTE: no balance column, by design. Balance = SUM(credits) - SUM(debits)
 * from ledger_entries (see the wallet_balances view).
 *
 * A wallet is either user-owned (user_id set) or a system wallet
 * (system_code set), never both - enforced by a CHECK in the migration.
 */
@Entity('wallets')
export class Wallet {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  label!: string | null;

  @Index()
  @Column({ name: 'user_id', type: 'uuid', nullable: true })
  userId!: string | null;

  // nullable because system wallets (e.g. PLATFORM_CASH_USD) have no owner
  @ManyToOne(() => User, (user) => user.wallets, {
    nullable: true,
    onDelete: 'RESTRICT',
  })
  @JoinColumn({
    name: 'user_id',
    foreignKeyConstraintName: 'wallets_user_id_fkey',
  })
  user!: User | null;

  @Column({
    name: 'system_code',
    type: 'varchar',
    length: 64,
    nullable: true,
    unique: true,
  })
  systemCode!: string | null;

  @Column({ type: 'char', length: 3 })
  currency!: string;

  @Column({
    type: 'enum',
    enumName: 'wallet_status',
    enum: WalletStatus,
    default: WalletStatus.ACTIVE,
  })
  status!: WalletStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
