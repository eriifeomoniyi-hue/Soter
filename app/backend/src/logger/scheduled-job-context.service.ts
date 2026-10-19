import { Injectable } from '@nestjs/common';

import {
  CORRELATION_ID_KEY,
  generateCorrelationId,
} from '../common/utils/correlation-id.util';
import { LoggerService } from './logger.service';

export interface ScheduledJobRunOptions {
  /**
   * Adopt an existing correlation id instead of generating one. Used when a
   * scheduled run hands its id to a queued job (BullMQ job data) so the
   * worker logs share the originating run's id.
   */
  correlationId?: string;
}

/**
 * Runs scheduled work (cron handlers, repeatable queue jobs) inside its own
 * correlation context.
 *
 * HTTP requests get a correlation id from `RequestCorrelationMiddleware`,
 * which stores it in the `LoggerService` AsyncLocalStorage so every log line
 * of the request carries it. Scheduled runs have no request to inherit from,
 * so they previously logged without any correlation id and the only way to
 * group a run's log lines was by timestamp.
 *
 * `run()` generates a fresh correlation id at the start of every run (or
 * adopts one from `options`), enters the same AsyncLocalStorage the logger
 * reads, and executes the job. While the job runs:
 *
 * - every log line emitted through `LoggerService` — including lines from
 *   `new Logger(...)` instances, which Nest routes through the app logger —
 *   is stamped with the run's correlation id;
 * - notifications enqueued during the run default their correlation id from
 *   this context (`NotificationsService` reads the same storage), so a
 *   notification can be traced back to the run that produced it.
 */
@Injectable()
export class ScheduledJobContextService {
  constructor(private readonly logger: LoggerService) {}

  /**
   * Execute `fn` within a fresh scheduled-job correlation context.
   *
   * The returned promise resolves/rejects exactly as `fn` does; failures are
   * logged (with the run's correlation id) before being re-thrown so
   * caller-side handling — including BullMQ's failed-job handling — is
   * unchanged.
   */
  run<T>(
    jobName: string,
    fn: () => T | Promise<T>,
    options: ScheduledJobRunOptions = {},
  ): Promise<T> {
    const correlationId = options.correlationId ?? generateCorrelationId();
    const store = new Map<string, unknown>();
    store.set(CORRELATION_ID_KEY, correlationId);

    return this.logger.getAsyncLocalStorage().run(store, async () => {
      const startedAt = Date.now();

      this.logger.debug(
        `Scheduled job "${jobName}" started`,
        'ScheduledJobContext',
      );

      try {
        const result = await fn();
        this.logger.debug(
          `Scheduled job "${jobName}" completed in ${Date.now() - startedAt}ms`,
          'ScheduledJobContext',
        );
        return result;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Scheduled job "${jobName}" failed after ${Date.now() - startedAt}ms: ${message}`,
          error instanceof Error ? error.stack : undefined,
          'ScheduledJobContext',
        );
        throw error;
      }
    });
  }

  /**
   * Correlation id of the currently running job, or `undefined` outside a
   * `run()` context (e.g. direct calls to a job's work method from a test).
   */
  getCorrelationId(): string | undefined {
    return this.logger.getCorrelationId();
  }
}
