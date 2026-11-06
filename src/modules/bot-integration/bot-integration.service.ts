import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { OtpCode } from './otp-code.entity';
import { BookingSync } from './booking-sync.entity';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

@Injectable()
export class BotIntegrationService {
  private otpRepository: Repository<OtpCode>;
  private bookingSyncRepository: Repository<BookingSync>;
  private readonly logger = new Logger('BotIntegration');

  constructor(
    @InjectDataSource('data') private dataSource: DataSource,
    private configService: ConfigService,
  ) {
    this.otpRepository = this.dataSource.getRepository(OtpCode);
    this.bookingSyncRepository = this.dataSource.getRepository(BookingSync);
  }

  private getBotSecret(): string {
    const secret = this.configService.get<string>('BOT_SECRET');
    if (!secret) {
      throw new Error('BOT_SECRET is not configured');
    }
    return secret;
  }

  /**
   * Verify the X-Bot-Secret header
   */
  verifyBotSecret(secret: string): boolean {
    const expectedSecret = this.getBotSecret();
    return secret === expectedSecret;
  }

  /**
   * Generate and store a 4-digit OTP code
   * If code is provided, use it; otherwise generate one
   */
  async generateOtp(phoneNumber: string, providedCode?: string): Promise<{ code: string; expiresAt: Date }> {
    // Clean phone number
    const cleanedPhone = this.cleanPhoneNumber(phoneNumber);

    // Use provided code or generate 4-digit code
    const code = providedCode || Math.floor(1000 + Math.random() * 9000).toString();

    // Set expiration to 5 minutes from now
    const expiresAt = new Date();
    expiresAt.setMinutes(expiresAt.getMinutes() + 5);

    // Delete any existing unverified codes for this phone
    await this.otpRepository.delete({
      phoneNumber: cleanedPhone,
      verified: false,
    });

    // Store the new code
    const otpRecord = this.otpRepository.create({
      id: randomUUID(),
      phoneNumber: cleanedPhone,
      code,
      expiresAt,
    });

    await this.otpRepository.save(otpRecord);

    this.logger.log(`Generated OTP for ${cleanedPhone}: ${code}`);

    return { code, expiresAt };
  }

  /**
   * Verify an OTP code
   */
  async verifyOtp(phoneNumber: string, code: string): Promise<boolean> {
    const cleanedPhone = this.cleanPhoneNumber(phoneNumber);

    const otpRecord = await this.otpRepository.findOne({
      where: {
        phoneNumber: cleanedPhone,
        code,
        verified: false,
      },
    });

    if (!otpRecord) {
      this.logger.warn(`Invalid OTP attempt for ${cleanedPhone}: ${code}`);
      return false;
    }

    // Check if expired
    if (new Date() > otpRecord.expiresAt) {
      this.logger.warn(`Expired OTP for ${cleanedPhone}: ${code}`);
      await this.otpRepository.delete({ id: otpRecord.id });
      return false;
    }

    // Mark as verified
    otpRecord.verified = true;
    await this.otpRepository.save(otpRecord);

    this.logger.log(`OTP verified for ${cleanedPhone}`);

    // Clean up old verified codes
    await this.otpRepository.delete({
      phoneNumber: cleanedPhone,
      verified: true,
    });

    return true;
  }

  /**
   * Sync a booking from Vercel to the bot database
   */
  async syncBooking(bookingData: {
    vercelBookingId: string;
    phoneNumber: string;
    customerName: string;
    service: string;
    appointmentDate: string;
    appointmentTime: string;
  }): Promise<BookingSync> {
    const cleanedPhone = this.cleanPhoneNumber(bookingData.phoneNumber);

    // Check if booking already exists
    const existing = await this.bookingSyncRepository.findOne({
      where: { vercelBookingId: bookingData.vercelBookingId },
    });

    if (existing) {
      // Update existing booking
      Object.assign(existing, bookingData);
      return this.bookingSyncRepository.save(existing);
    }

    // Create new booking sync record
    const bookingSync = this.bookingSyncRepository.create({
      id: randomUUID(),
      vercelBookingId: bookingData.vercelBookingId,
      phoneNumber: cleanedPhone,
      customerName: bookingData.customerName,
      service: bookingData.service,
      appointmentDate: new Date(bookingData.appointmentDate),
      appointmentTime: bookingData.appointmentTime,
      status: 'pending',
    });

    const saved = await this.bookingSyncRepository.save(bookingSync);
    this.logger.log(`Synced booking ${bookingData.vercelBookingId} for ${cleanedPhone}`);

    return saved;
  }

  /**
   * Get bookings that need reminders (60 minutes before appointment)
   * Includes reboot safety: skips reminders for past appointment times
   */
  async getBookingsNeedingReminder(): Promise<BookingSync[]> {
    const now = new Date();
    const candidates = await this.bookingSyncRepository.find({
      where: { status: 'pending', reminderSent: false },
    });

    return candidates.filter((booking) => {
      const date = booking.appointmentDate instanceof Date
        ? booking.appointmentDate.toISOString().slice(0, 10)
        : String(booking.appointmentDate).slice(0, 10);
      const appointment = this.zonedDateTimeToUtc(
        date,
        booking.appointmentTime,
        'Asia/Hebron',
      );
      const minutesUntilAppointment = (appointment.getTime() - now.getTime()) / 60_000;
      return minutesUntilAppointment > 0 && minutesUntilAppointment <= 60;
    });
  }

  private zonedDateTimeToUtc(date: string, time: string, timeZone: string): Date {
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    const desiredUtc = Date.UTC(year, month - 1, day, hour, minute);
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    const parts = Object.fromEntries(
      formatter.formatToParts(new Date(desiredUtc)).map((part) => [part.type, part.value]),
    );
    const representedUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
    );
    const firstPass = desiredUtc - (representedUtc - desiredUtc);
    const secondParts = Object.fromEntries(
      formatter.formatToParts(new Date(firstPass)).map((part) => [part.type, part.value]),
    );
    const secondRepresentedUtc = Date.UTC(
      Number(secondParts.year),
      Number(secondParts.month) - 1,
      Number(secondParts.day),
      Number(secondParts.hour),
      Number(secondParts.minute),
    );
    return new Date(firstPass - (secondRepresentedUtc - desiredUtc));
  }

  /**
   * Mark reminder as sent
   */
  async markReminderSent(bookingId: string): Promise<void> {
    await this.bookingSyncRepository.update(bookingId, {
      reminderSent: true,
      reminderSentAt: new Date(),
    });
  }

  /**
   * Handle customer response (1 for confirm, 2 for cancel)
   */
  async handleCustomerResponse(phoneNumber: string, response: string): Promise<BookingSync | null> {
    const cleanedPhone = this.cleanPhoneNumber(phoneNumber);

    const booking = await this.bookingSyncRepository.findOne({
      where: {
        phoneNumber: cleanedPhone,
        status: 'pending',
      },
      order: { createdAt: 'DESC' },
    });

    if (!booking) {
      this.logger.warn(`No pending booking found for ${cleanedPhone}`);
      return null;
    }

    booking.customerResponse = response;
    booking.customerResponseAt = new Date();
    booking.status = response === '1' ? 'confirmed' : 'cancelled';

    await this.bookingSyncRepository.save(booking);

    this.logger.log(`Customer ${cleanedPhone} responded with ${response} for booking ${booking.vercelBookingId}`);

    return booking;
  }

  /**
   * Clean phone number - add country code if missing
   * Returns format: +9705XXXXXXXX or +9725XXXXXXXX
   */
  cleanPhoneNumber(phone: string): string {
    let cleaned = phone.replace(/\D/g, ''); // Remove all non-digits

    // If starts with 0, remove it
    if (cleaned.startsWith('0')) {
      cleaned = cleaned.substring(1);
    }

    // If no country code, try to detect based on length
    if (cleaned.length === 9 && cleaned.startsWith('5')) {
      // Palestinian/Israeli number starting with 5, add +970 by default
      cleaned = '970' + cleaned;
    } else if (cleaned.length === 10 && cleaned.startsWith('0')) {
      // Has leading 0, remove and add code
      cleaned = '970' + cleaned.substring(1);
    }

    return '+' + cleaned;
  }

  /**
   * Format phone number for WhatsApp (without + prefix)
   * Returns format: 9705XXXXXXXX or 9725XXXXXXXX
   */
  formatForWhatsApp(phone: string): string {
    const cleaned = this.cleanPhoneNumber(phone);
    return cleaned.replace('+', '');
  }

  /**
   * Get alternative country code for fallback
   * If number has 970, return 972; if 972, return 970
   */
  getAlternativeCountryCode(phone: string): string {
    const cleaned = this.cleanPhoneNumber(phone);
    if (cleaned.startsWith('+970')) {
      return cleaned.replace('+970', '+972');
    } else if (cleaned.startsWith('+972')) {
      return cleaned.replace('+972', '+970');
    }
    return cleaned;
  }

  /**
   * Sanitize phone number - remove spaces, dashes, special characters
   * Returns clean digits-only string
   */
  sanitizePhoneNumber(phone: string): string {
    // Remove all non-digit characters except leading +
    let sanitized = phone.replace(/[^\d+]/g, '');
    
    // If has + but no country code after it, remove the +
    if (sanitized.startsWith('+') && sanitized.length === 1) {
      sanitized = sanitized.substring(1);
    }
    
    return sanitized;
  }

  /**
   * Get all possible phone number variations for fallback
   * Returns array of phone numbers with different country codes
   */
  getPhoneNumberVariations(phone: string): string[] {
    const cleaned = this.cleanPhoneNumber(phone);
    const variations: string[] = [];

    // Add the cleaned version
    variations.push(cleaned);

    // Add alternative country code if applicable
    if (cleaned.startsWith('+970')) {
      variations.push(cleaned.replace('+970', '+972'));
    } else if (cleaned.startsWith('+972')) {
      variations.push(cleaned.replace('+972', '+970'));
    }

    // Add version without + prefix for WhatsApp JID
    variations.push(cleaned.replace('+', ''));

    // Add alternative without + prefix
    if (cleaned.startsWith('+970')) {
      variations.push(cleaned.replace('+970', '972'));
    } else if (cleaned.startsWith('+972')) {
      variations.push(cleaned.replace('+972', '970'));
    }

    // Remove duplicates
    return [...new Set(variations)];
  }

  /**
   * Format phone number for WhatsApp JID format
   * Returns format: phoneNumber@s.whatsapp.net
   */
  formatForWhatsAppJid(phone: string): string {
    const formatted = this.formatForWhatsApp(phone);
    return `${formatted}@s.whatsapp.net`;
  }

  /**
   * Get alternative WhatsApp JID for fallback
   */
  getAlternativeWhatsAppJid(phone: string): string {
    const alternative = this.getAlternativeCountryCode(phone);
    return this.formatForWhatsAppJid(alternative);
  }

  /**
   * Send text review request via WhatsApp
   */
  async sendReviewRequest(phoneNumber: string, sessionId?: string): Promise<any> {
    const cleanedPhone = this.cleanPhoneNumber(phoneNumber);
    return {
      phoneNumber: cleanedPhone,
      sessionId,
      message: 'كيف كانت تجربتك معنا؟ نسعد بسماع رأيك وملاحظاتك! يرجى الرد على هذه الرسالة بتعليقك.',
    };
  }
}
