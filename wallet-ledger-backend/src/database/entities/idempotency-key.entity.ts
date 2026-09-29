import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { IdempotencyStatus } from 'src/common/types/idempotency.enum';

/**
 * One row per (user, Idempotency-Key). The PENDING -> COMPLETED transition
 * is how a second concurrent request with the same key is detected: it tries
 * to INSERT the same (user_id, key) and hits the unique constraint instead of
 * racing the handler a second time.
 */
@Entity('idempotency_keys')
@Index(['userId', 'key'], { unique: true })
export class IdempotencyKeyRecord {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ type: 'varchar', length: 255 })
  key!: string;

  // sha256 of method + path + body, so the SAME key with a DIFFERENT body is
  // rejected instead of silently replaying the wrong response.
  @Column({ name: 'request_hash', type: 'varchar', length: 64 })
  requestHash!: string;

  @Column({
    type: 'enum',
    enum: IdempotencyStatus,
    enumName: 'idempotency_status',
    default: IdempotencyStatus.PENDING,
  })
  status!: IdempotencyStatus;

  @Column({ name: 'response_status', type: 'int', nullable: true })
  responseStatus!: number | null;

  // Stored as text (JSON.stringify'd) rather than jsonb so it round-trips
  // exactly, including values the handler already serialized (e.g. bigint-as-string).
  @Column({ name: 'response_body', type: 'text', nullable: true })
  responseBody!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
