import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ReviewLockService } from './review-lock.service';
import { ScheduledJobContextService } from '../logger/scheduled-job-context.service';

@Injectable()
export class ReviewLockScheduler {
  private readonly logger = new Logger(ReviewLockScheduler.name);

  constructor(
    private readonly reviewLockService: ReviewLockService,
    private readonly scheduledJobContext: ScheduledJobContextService,
  ) {}

  /**
   * Recover stale locks every 2 minutes.
   * Locks that have been expired for more than 2 minutes are force-expired.
   */
  @Cron('*/2 * * * *', {
    name: 'review-lock-recovery',
  })
  async recoverStaleLocks() {
    return this.scheduledJobContext.run('review-lock-recovery', async () => {
      this.logger.debug('Starting stale lock recovery...');

      try {
        const recoveredCount = await this.reviewLockService.recoverStaleLocks();

        if (recoveredCount > 0) {
          this.logger.log(`Recovered ${recoveredCount} stale locks`);
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown error';
        this.logger.error(`Failed to recover stale locks: ${errorMessage}`);
      }
    });
  }
}
