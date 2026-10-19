import { Test, TestingModule } from '@nestjs/testing';
import { ApiKeyExpiryProcessor } from './api-key-expiry.processor';
import { ApiKeysService } from './api-keys.service';
import { LoggerService } from '../logger/logger.service';
import { ScheduledJobContextService } from '../logger/scheduled-job-context.service';

describe('ApiKeyExpiryProcessor', () => {
  it('delegates to ApiKeysService.surfaceUpcomingExpirations', async () => {
    const apiKeys = {
      surfaceUpcomingExpirations: jest
        .fn()
        .mockResolvedValue([{ id: 'k1' }, { id: 'k2' }]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyExpiryProcessor,
        { provide: ApiKeysService, useValue: apiKeys },
        LoggerService,
        ScheduledJobContextService,
      ],
    }).compile();

    const processor = module.get(ApiKeyExpiryProcessor);
    const result = await processor.process({ id: 'job-1' } as any);

    expect(apiKeys.surfaceUpcomingExpirations).toHaveBeenCalled();
    expect(result).toEqual({ reminded: 2 });
  });

  it('runs each scheduled run inside its own correlation context', async () => {
    const apiKeys = {
      surfaceUpcomingExpirations: jest.fn().mockResolvedValue([]),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyExpiryProcessor,
        { provide: ApiKeysService, useValue: apiKeys },
        LoggerService,
        ScheduledJobContextService,
      ],
    }).compile();

    const processor = module.get(ApiKeyExpiryProcessor);
    const jobContext = module.get(ScheduledJobContextService);
    const seenIds: Array<string | undefined> = [];

    apiKeys.surfaceUpcomingExpirations
      .mockResolvedValueOnce([])
      .mockImplementationOnce(() => {
        seenIds.push(jobContext.getCorrelationId());
        return Promise.resolve([]);
      });

    await processor.process({ id: 'job-1' } as any);
    expect(jobContext.getCorrelationId()).toBeUndefined();

    await processor.process({ id: 'job-2' } as any);
    expect(seenIds[0]).toEqual(expect.any(String));
  });
});
