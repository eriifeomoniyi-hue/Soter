import { Queue } from 'bullmq';
import {
  IDEMPOTENCY_KEY_EXPIRY_SCOPE,
  RetentionPurgeJobData,
} from './retention-purge.processor';
import { RetentionPurgeScheduler } from './retention-purge.scheduler';
import { MetricsService } from '../observability/metrics/metrics.service';
import { ConfigService } from '@nestjs/config';
import { LoggerService } from '../logger/logger.service';
import { ScheduledJobContextService } from '../logger/scheduled-job-context.service';

describe('RetentionPurgeScheduler', () => {
  let queue: { add: jest.Mock };
  let metrics: { recordIdempotencyPurgeFailure: jest.Mock };
  let scheduler: RetentionPurgeScheduler;

  beforeEach(() => {
    queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    metrics = { recordIdempotencyPurgeFailure: jest.fn() };

    scheduler = new RetentionPurgeScheduler(
      queue as unknown as Queue<RetentionPurgeJobData>,
      { get: jest.fn() } as unknown as ConfigService,
      metrics as unknown as MetricsService,
      new ScheduledJobContextService(new LoggerService()),
    );
  });

  it('enqueues an idempotency key expiry purge job when the cron fires', async () => {
    await scheduler.scheduleIdempotencyKeyExpiryPurge();

    expect(queue.add).toHaveBeenCalledTimes(1);
    expect(queue.add).toHaveBeenCalledWith(
      IDEMPOTENCY_KEY_EXPIRY_SCOPE,
      expect.objectContaining({
        scope: IDEMPOTENCY_KEY_EXPIRY_SCOPE,
        triggeredBy: 'cron',
        timestamp: expect.any(Number),
        correlationId: expect.any(String),
      }),
      expect.objectContaining({ attempts: 2 }),
    );
  });

  it('gives every scheduled run its own correlation id', async () => {
    await scheduler.scheduleIdempotencyKeyExpiryPurge();
    await scheduler.scheduleIdempotencyKeyExpiryPurge();

    const enqueuedIds = queue.add.mock.calls.map(
      ([, data]: [string, { correlationId?: string }]) => data.correlationId,
    );

    expect(enqueuedIds[0]).toEqual(expect.any(String));
    expect(enqueuedIds[1]).toEqual(expect.any(String));
    expect(enqueuedIds[0]).not.toBe(enqueuedIds[1]);
  });

  it('stamps the daily purge job with the scheduling run correlation id', async () => {
    await scheduler.scheduleDailyPurge();

    expect(queue.add).toHaveBeenCalledWith(
      'scheduled-purge',
      expect.objectContaining({ correlationId: expect.any(String) }),
      expect.anything(),
    );
  });

  it('skips scheduling when a previous run is still in flight', async () => {
    let resolveAdd!: (value: { id: string }) => void;
    queue.add.mockReturnValueOnce(
      new Promise(resolve => {
        resolveAdd = resolve;
      }),
    );

    const first = scheduler.scheduleIdempotencyKeyExpiryPurge();
    const second = scheduler.scheduleIdempotencyKeyExpiryPurge();

    resolveAdd({ id: 'job-1' });
    await Promise.all([first, second]);

    expect(queue.add).toHaveBeenCalledTimes(1);
  });

  it('does not throw when enqueueing fails and records the failure', async () => {
    queue.add.mockRejectedValue(new Error('redis unavailable'));

    await expect(
      scheduler.scheduleIdempotencyKeyExpiryPurge(),
    ).resolves.toBeUndefined();

    expect(metrics.recordIdempotencyPurgeFailure).toHaveBeenCalledWith(
      'scheduling: redis unavailable',
    );
  });
});
