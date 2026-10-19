import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ApiKeysService } from './api-keys.service';
import { ScheduledJobContextService } from '../logger/scheduled-job-context.service';

export const API_KEY_EXPIRY_QUEUE = 'api-key-expiry';

@Processor(API_KEY_EXPIRY_QUEUE)
export class ApiKeyExpiryProcessor extends WorkerHost {
  private readonly logger = new Logger(ApiKeyExpiryProcessor.name);

  constructor(
    private readonly apiKeys: ApiKeysService,
    private readonly scheduledJobContext: ScheduledJobContextService,
  ) {
    super();
  }

  async process(job: Job): Promise<{ reminded: number }> {
    // Repeatable jobs have no HTTP origin: every run generates its own
    // correlation id so its log lines and notifications can be traced as one
    // run.
    return this.scheduledJobContext.run('api-key-expiry', async () => {
      this.logger.log(`Processing API key expiry reminders (Job: ${job.id})`);
      const reminders = await this.apiKeys.surfaceUpcomingExpirations();
      return { reminded: reminders.length };
    });
  }
}
