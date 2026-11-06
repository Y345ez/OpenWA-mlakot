import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BotIntegrationController } from './bot-integration.controller';
import { BotIntegrationService } from './bot-integration.service';
import { OtpCode } from './otp-code.entity';
import { BookingSync } from './booking-sync.entity';
import { MessageModule } from '../message/message.module';
import { SessionModule } from '../session/session.module';
import { ReminderSchedulerService } from './reminder-scheduler.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([OtpCode, BookingSync], 'data'),
    MessageModule,
    SessionModule,
  ],
  controllers: [BotIntegrationController],
  providers: [BotIntegrationService, ReminderSchedulerService],
  exports: [BotIntegrationService],
})
export class BotIntegrationModule {}
