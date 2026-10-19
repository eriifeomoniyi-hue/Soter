import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { InviteStatus } from '@prisma/client';
import { ScheduledJobContextService } from '../logger/scheduled-job-context.service';

export const INVITE_EXPIRY_QUEUE = 'invite-expiry';

@Processor(INVITE_EXPIRY_QUEUE)
export class InvitesProcessor extends WorkerHost {
  private readonly logger = new Logger(InvitesProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduledJobContext: ScheduledJobContextService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    // Repeatable jobs have no HTTP origin: every run generates its own
    // correlation id so its log lines can be traced as one run.
    return this.scheduledJobContext.run('invite-expiry', async () => {
      this.logger.log(`Processing invite expiry check (Job: ${job.id})`);

      const result = await this.prisma.invite.updateMany({
        where: {
          status: InviteStatus.pending,
          expiresAt: { lt: new Date() },
        },
        data: {
          status: InviteStatus.expired,
        },
      });

      if (result.count > 0) {
        this.logger.log(
          `Invite expiry check completed. Expired ${result.count} invites.`,
        );
      }
    });
  }
}
