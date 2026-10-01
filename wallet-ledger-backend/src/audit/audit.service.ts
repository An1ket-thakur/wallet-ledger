import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { AdminAction } from 'src/database/entities/admin-action.entity';
import { EntityManager, Repository } from 'typeorm';

export interface RecordActionInput {
  actorUserId: string;
  actorRole: string;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string | null;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AdminAction)
    private readonly actions: Repository<AdminAction>,
  ) {}

  /**
   * Accepts an optional EntityManager so the audit row can be written inside
   * the SAME database transaction as the action it's recording (e.g. a
   * refund) - if the refund rolls back, so does its own audit entry, and you
   * never end up with an audit log claiming something happened that the
   * ledger says didn't.
   */
  async record(
    input: RecordActionInput,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(AdminAction) : this.actions;
    await repo.insert({
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      action: input.action,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      details: (input.details ?? null) as any,
      ipAddress: input.ipAddress ?? null,
    });
  }

  async listRecent(limit = 50): Promise<AdminAction[]> {
    return this.actions.find({ order: { createdAt: 'DESC' }, take: limit });
  }
}
