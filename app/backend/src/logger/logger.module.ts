import { Module } from '@nestjs/common';
import { LoggerService } from './logger.service';
import { ScheduledJobContextService } from './scheduled-job-context.service';

@Module({
  providers: [LoggerService, ScheduledJobContextService],
  exports: [LoggerService, ScheduledJobContextService],
})
export class LoggerModule {}
