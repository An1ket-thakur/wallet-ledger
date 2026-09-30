import { Injectable } from '@nestjs/common';

/**
 * Stands in for a real external payout provider (bank transfer, card payout,
 * etc). Real processors are asynchronous and can fail for reasons entirely
 * outside your control - this simulates that by randomly failing ~15% of
 * the time, so the PENDING -> FAILED path in TransactionsService actually
 * gets exercised in testing, not just the happy path.
 */
@Injectable()
export class MockPayoutProcessorService {
  async submitPayout(
    amountMinorUnits: number,
  ): Promise<{ success: boolean; reason?: string }> {
    // Simulated network latency.
    await new Promise((resolve) => setTimeout(resolve, 50));

    // A real processor often has its own minimum payout threshold.
    if (amountMinorUnits < 100) {
      return {
        success: false,
        reason:
          'Payout provider declined: amount below minimum payout threshold',
      };
    }

    if (Math.random() < 0.15) {
      return {
        success: false,
        reason: 'Payout provider declined: destination account unreachable',
      };
    }
    return { success: true };
  }
}
