import { Logger } from '@nestjs/common';

import { LoggerService } from './logger.service';
import { ScheduledJobContextService } from './scheduled-job-context.service';

type PinoLike = {
  info: (...args: unknown[]) => void;
  debug: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
};

describe('ScheduledJobContextService', () => {
  let loggerService: LoggerService;
  let service: ScheduledJobContextService;
  let pino: PinoLike;
  let infoSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    loggerService = new LoggerService();
    service = new ScheduledJobContextService(loggerService);

    pino = (loggerService as unknown as { logger: PinoLike }).logger;
    infoSpy = jest.spyOn(pino, 'info');
    debugSpy = jest.spyOn(pino, 'debug');
    errorSpy = jest.spyOn(pino, 'error');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('generates a fresh correlation id at the start of every run', async () => {
    const ids = await Promise.all([
      service.run('job-a', () => service.getCorrelationId()),
      service.run('job-b', () => service.getCorrelationId()),
    ]);

    expect(ids[0]).toEqual(expect.any(String));
    expect(ids[1]).toEqual(expect.any(String));
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('exposes the run correlation id inside the job and clears it outside', async () => {
    const inside = await service.run('job-a', () => service.getCorrelationId());

    expect(inside).toEqual(expect.any(String));
    expect(service.getCorrelationId()).toBeUndefined();
  });

  it('adopts a caller-provided correlation id so queued work shares the run id', async () => {
    const adopted = await service.run(
      'queued-job',
      () => service.getCorrelationId(),
      { correlationId: 'run-origin-id' },
    );

    expect(adopted).toBe('run-origin-id');
  });

  it('keeps concurrent runs isolated from each other', async () => {
    const slow = service.run('slow-job', async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return service.getCorrelationId();
    });
    const fast = service.run('fast-job', () => service.getCorrelationId());

    const [slowId, fastId] = await Promise.all([slow, fast]);

    expect(slowId).not.toBe(fastId);
    expect(await slow).toBe(slowId);
  });

  it('stamps log lines emitted inside the run with the run correlation id', async () => {
    const runId = await service.run('job-a', () => {
      loggerService.log('inside the run', 'TestContext');
      return service.getCorrelationId();
    });

    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: runId }),
      'inside the run',
    );
  });

  it('stamps log lines from Nest Logger instances routed through the app logger', async () => {
    const originalRef = (
      Logger as unknown as {
        staticInstanceRef?: unknown;
      }
    ).staticInstanceRef;

    (Logger as unknown as { staticInstanceRef?: unknown }).staticInstanceRef =
      loggerService;

    try {
      const runId = await service.run('job-a', () => {
        new Logger('TestContext').log('from a Nest logger');
        return service.getCorrelationId();
      });

      expect(infoSpy).toHaveBeenCalledWith(
        expect.objectContaining({ correlationId: runId }),
        'from a Nest logger',
      );
    } finally {
      (Logger as unknown as { staticInstanceRef?: unknown }).staticInstanceRef =
        originalRef;
    }
  });

  it('logs run boundaries with the job name and correlation id', async () => {
    const runId = await service.run('job-a', () => service.getCorrelationId());

    expect(runId).toEqual(expect.any(String));
    expect(debugSpy).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: runId }),
      'Scheduled job "job-a" started',
    );
    expect(debugSpy).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: runId }),
      expect.stringContaining('Scheduled job "job-a" completed'),
    );
  });

  it('logs the failure with the run correlation id and re-throws', async () => {
    await expect(
      service.run('job-a', () => {
        throw new Error('explosion');
      }),
    ).rejects.toThrow('explosion');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        trace: expect.stringContaining('explosion'),
      }),
      expect.stringContaining('Scheduled job "job-a" failed'),
    );
    expect(service.getCorrelationId()).toBeUndefined();
  });

  it('propagates the job result to the caller', async () => {
    const result = await service.run('job-a', () => 42);

    expect(result).toBe(42);
  });
});
