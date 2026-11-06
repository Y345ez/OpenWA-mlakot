import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { BotIntegrationService } from './bot-integration.service';
import { MessageService } from '../message/message.service';
import { ConfigService } from '@nestjs/config';
import { SessionService } from '../session/session.service';

@Injectable()
export class ReminderSchedulerService implements OnModuleInit {
  private readonly logger = new Logger('ReminderScheduler');
  private cronEnabled: boolean;
  private isRunning = false;

  constructor(
    private readonly botIntegrationService: BotIntegrationService,
    private readonly messageService: MessageService,
    private readonly configService: ConfigService,
    private readonly sessionService: SessionService,
  ) {
    this.cronEnabled = this.configService.get<boolean>('REMINDER_CRON_ENABLED', true);
  }

  onModuleInit() {
    this.logger.log('Reminder Scheduler initialized');
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async handleReminders() {
    if (!this.cronEnabled || this.isRunning) {
      return;
    }

    this.isRunning = true;

    try {
      const bookingsNeedingReminder = await this.botIntegrationService.getBookingsNeedingReminder();

      if (bookingsNeedingReminder.length === 0) {
        return;
      }

      this.logger.log(`Found ${bookingsNeedingReminder.length} bookings needing reminders`);

      const sessions = await this.sessionService.findAll(null, { limit: 10 });
      const readySession = sessions.find((session) => session.status === 'ready');
      if (!readySession) {
        this.logger.warn('Reminder skipped because no WhatsApp session is ready');
        return;
      }
      const sessionId = readySession.id;

      for (const booking of bookingsNeedingReminder) {
        try {
          // Send reminder message
         

// Convert appointment date to Date safely
const appointmentDate = new Date(booking.appointmentDate);

if (Number.isNaN(appointmentDate.getTime())) {
  this.logger.error(
    `Invalid appointment date for booking ${booking.vercelBookingId}: ${booking.appointmentDate}`,
  );
  continue;
}

const formattedDate = appointmentDate.toLocaleDateString('ar-EG', {
  timeZone: 'Asia/Hebron',
});

// Send reminder message
const message = `تذكير: موعدك في الحلاقة بعد ساعة واحدة\n\n📅 التاريخ: ${formattedDate}\n⏰ الوقت: ${booking.appointmentTime}\n💇 الخدمة: ${booking.service}\n\nيرجى الرد:\n1 - للتأكيد الحضور\n2 - للإلغاء`;



          // Get all phone number variations for fallback
          const phoneVariations = this.botIntegrationService.getPhoneNumberVariations(booking.phoneNumber);
          let lastError = null;
          let sentSuccessfully = false;

          for (const phoneVar of phoneVariations) {
            try {
              const phoneForWhatsApp = phoneVar.replace('+', '');
              await this.messageService.sendText(sessionId, {
                chatId: `${phoneForWhatsApp}@c.us`,
                text: message,
              });

              this.logger.log(`Reminder sent for booking ${booking.vercelBookingId} to ${phoneVar}`);
              sentSuccessfully = true;
              break;
            } catch (error) {
              lastError = error;
              this.logger.warn(`Failed to send reminder to ${phoneVar}, trying next variation...`);
              continue;
            }
          }

          if (sentSuccessfully) {
            await this.botIntegrationService.markReminderSent(booking.id);
          } else {
            this.logger.error(`Failed to send reminder for booking ${booking.vercelBookingId} with all phone variations`);
          }
        } catch (error) {
          this.logger.error(`Failed to send reminder for booking ${booking.vercelBookingId}:`, error);
        }
      }
    } catch (error) {
      this.logger.error('Error in reminder scheduler:', error);
    } finally {
      this.isRunning = false;
    }
  }
}
