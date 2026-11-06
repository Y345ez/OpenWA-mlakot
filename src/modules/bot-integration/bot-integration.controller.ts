import { Controller, Post, Body, HttpCode, HttpStatus, Headers, BadRequestException, Logger } from '@nestjs/common';
import { Public } from '../auth/decorators/auth.decorators';
import { BotIntegrationService } from './bot-integration.service';
import { MessageService } from '../message/message.service';
import { ConfigService } from '@nestjs/config';
import { SessionService } from '../session/session.service';

@Controller('bot-integration')
export class BotIntegrationController {
  private readonly logger = new Logger('BotIntegrationController');

  constructor(
    private readonly botIntegrationService: BotIntegrationService,
    private readonly messageService: MessageService,
    private readonly configService: ConfigService,
    private readonly sessionService: SessionService,
  ) {}

  /**
   * Endpoint to request OTP to be sent via WhatsApp
   * Called from Vercel when user requests OTP
   */
  @Public()
  @Post('send-otp')
  @HttpCode(HttpStatus.OK)
  async sendOtp(
    @Headers('x-bot-secret') botSecret: string,
    @Body() body: { phoneNumber: string; sessionId?: string; code?: string },
  ) {
    // Verify bot secret
    if (!this.botIntegrationService.verifyBotSecret(botSecret)) {
      this.logger.warn('Invalid bot secret in send-otp request');
      throw new BadRequestException('Invalid bot secret');
    }

    const { phoneNumber, sessionId, code } = body;

    if (!phoneNumber) {
      throw new BadRequestException('Phone number is required');
    }

    // Generate OTP if not provided (for backward compatibility)
    const { code: otpCode, expiresAt } = await this.botIntegrationService.generateOtp(phoneNumber, code);

    // Send OTP via WhatsApp with automatic fallback
    try {
      // Get the first active session
      const sessions = await this.sessionService.findAll(null, { limit: 10 });
      const readySession = sessions.find(s => s.status === 'ready');

      if (!readySession) {
        this.logger.warn('No active WhatsApp session found when attempting to send OTP');
        return {
          success: false,
          message: 'WhatsApp Bot is offline/disconnected. Please check bot session at http://localhost:2785',
          error: 'NO_ACTIVE_SESSION',
          sessionId: null,
        };
      }

      const targetSessionId = sessionId || readySession.id;
      const formattedPhone = this.botIntegrationService.cleanPhoneNumber(phoneNumber);
      const message = `رمز التحقق الخاص بك هو: ${otpCode}. ينتهي الكود خلال 60 ثانية.`;

      // Get all phone number variations for fallback
      const phoneVariations = this.botIntegrationService.getPhoneNumberVariations(phoneNumber);
      let lastError = null;

      // Try each variation until one succeeds
      for (const phoneVar of phoneVariations) {
        try {
          const phoneForWhatsApp = phoneVar.replace('+', '');
          await this.messageService.sendText(targetSessionId, {
            chatId: `${phoneForWhatsApp}@c.us`,
            text: message,
          });

          this.logger.log(`OTP sent to ${phoneVar} via session ${targetSessionId}`);

          return {
            success: true,
            message: 'OTP sent successfully',
            expiresAt: expiresAt.toISOString(),
            phoneUsed: phoneVar,
          };
        } catch (error) {
          lastError = error;
          this.logger.warn(`Failed to send OTP to ${phoneVar}, trying next variation...`);
          continue;
        }
      }

      // All variations failed
      this.logger.error(`Failed to send OTP with all phone variations for ${phoneNumber}`);
      return {
        success: false,
        message: 'Failed to send OTP via WhatsApp. The phone number may not be registered on WhatsApp.',
        error: 'SEND_FAILED',
        details: lastError instanceof Error ? lastError.message : String(lastError),
      };
    } catch (error) {
      this.logger.error(`Unexpected error sending OTP to ${phoneNumber}:`, error);
      return {
        success: false,
        message: 'An unexpected error occurred while sending OTP',
        error: 'UNEXPECTED_ERROR',
        details: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Endpoint to verify OTP
   * Called from Vercel when user submits OTP
   */
  @Public()
  @Post('verify-otp')
  @HttpCode(HttpStatus.OK)
  async verifyOtp(
    @Headers('x-bot-secret') botSecret: string,
    @Body() body: { phoneNumber: string; code: string },
  ) {
    // Verify bot secret
    if (!this.botIntegrationService.verifyBotSecret(botSecret)) {
      this.logger.warn('Invalid bot secret in verify-otp request');
      throw new BadRequestException('Invalid bot secret');
    }

    const { phoneNumber, code } = body;

    if (!phoneNumber || !code) {
      throw new BadRequestException('Phone number and code are required');
    }

    const isValid = await this.botIntegrationService.verifyOtp(phoneNumber, code);

    return {
      success: isValid,
      message: isValid ? 'OTP verified successfully' : 'Invalid or expired OTP',
    };
  }

  /**
   * Endpoint to sync booking from Vercel
   * Called when a new booking is created on Vercel
   */
  @Public()
  @Post('sync-booking')
  @HttpCode(HttpStatus.OK)
  async syncBooking(
    @Headers('x-bot-secret') botSecret: string,
    @Body() body: {
      vercelBookingId: string;
      phoneNumber: string;
      customerName: string;
      service: string;
      appointmentDate: string;
      appointmentTime: string;
    },
  ) {
    // Verify bot secret
    if (!this.botIntegrationService.verifyBotSecret(botSecret)) {
      this.logger.warn('Invalid bot secret in sync-booking request');
      throw new BadRequestException('Invalid bot secret');
    }

    const booking = await this.botIntegrationService.syncBooking(body);

    return {
      success: true,
      bookingId: booking.id,
      message: 'Booking synced successfully',
    };
  }

  /**
   * Webhook endpoint to handle customer responses (1 for confirm, 2 for cancel)
   * Called from the bot when customer responds to reminder
   */
  @Public()
  @Post('customer-response')
  @HttpCode(HttpStatus.OK)
  async handleCustomerResponse(
    @Headers('x-bot-secret') botSecret: string,
    @Body() body: { phoneNumber: string; response: string },
  ) {
    // Verify bot secret
    if (!this.botIntegrationService.verifyBotSecret(botSecret)) {
      this.logger.warn('Invalid bot secret in customer-response request');
      throw new BadRequestException('Invalid bot secret');
    }

    const { phoneNumber, response } = body;

    if (!phoneNumber || !response) {
      throw new BadRequestException('Phone number and response are required');
    }

    const booking = await this.botIntegrationService.handleCustomerResponse(phoneNumber, response);

    if (!booking) {
      return {
        success: false,
        message: 'No pending booking found',
      };
    }

    // Send response back to Vercel to update booking status
    try {
      const vercelUrl = this.configService.get<string>('VERCEL_API_URL');
      const vercelSecret = this.configService.get<string>('BOT_SECRET');

      if (vercelUrl && vercelSecret) {
        const vercelResponse = await fetch(`${vercelUrl}/api/bookings/webhook-response`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Bot-Secret': vercelSecret,
          },
          body: JSON.stringify({
            vercelBookingId: booking.vercelBookingId,
            response: booking.customerResponse,
            phoneNumber: booking.phoneNumber,
          }),
        });

        if (!vercelResponse.ok) {
          this.logger.error(`Failed to send response to Vercel: ${vercelResponse.statusText}`);
        } else {
          this.logger.log(`Successfully sent response to Vercel for booking ${booking.vercelBookingId}`);
        }
      }
    } catch (error) {
      this.logger.error('Error sending response to Vercel:', error);
    }

    return {
      success: true,
      bookingId: booking.vercelBookingId,
      status: booking.status,
      message: 'Customer response recorded',
    };
  }

  /**
   * Endpoint to send a custom message via WhatsApp
   * Called from Vercel when booking status changes or manual reminder is triggered
   */
  @Public()
  @Post('send-message')
  @HttpCode(HttpStatus.OK)
  async sendMessage(
    @Headers('x-bot-secret') botSecret: string,
    @Body() body: { phoneNumber: string; message: string },
  ) {
    // Verify bot secret
    if (!this.botIntegrationService.verifyBotSecret(botSecret)) {
      this.logger.warn('Invalid bot secret in send-message request');
      throw new BadRequestException('Invalid bot secret');
    }

    const { phoneNumber, message } = body;

    if (!phoneNumber || !message) {
      throw new BadRequestException('Phone number and message are required');
    }

    // Get the first active session
    const sessions = await this.sessionService.findAll(null, { limit: 10 });
    const readySession = sessions.find(s => s.status === 'ready');

    if (!readySession) {
      this.logger.warn('No active WhatsApp session found when attempting to send message');
      return {
        success: false,
        message: 'WhatsApp Bot is offline/disconnected. Please check bot session',
        error: 'NO_ACTIVE_SESSION',
      };
    }

    const formattedPhone = this.botIntegrationService.cleanPhoneNumber(phoneNumber);

    // Get all phone number variations for fallback
    const phoneVariations = this.botIntegrationService.getPhoneNumberVariations(phoneNumber);
    let lastError = null;

    // Try each variation until one succeeds
    for (const phoneVar of phoneVariations) {
      try {
        const phoneForWhatsApp = phoneVar.replace('+', '');
        await this.messageService.sendText(readySession.id, {
          chatId: `${phoneForWhatsApp}@c.us`,
          text: message,
        });

        this.logger.log(`Message sent to ${phoneVar} via session ${readySession.id}`);

        return {
          success: true,
          message: 'Message sent successfully',
          phoneUsed: phoneVar,
        };
      } catch (error) {
        lastError = error;
        this.logger.warn(`Failed to send message to ${phoneVar}, trying next variation...`);
        continue;
      }
    }

    // All variations failed
    this.logger.error(`Failed to send message with all phone variations for ${phoneNumber}`);
    return {
      success: false,
      message: 'Failed to send message via WhatsApp. The phone number may not be registered on WhatsApp.',
      error: 'SEND_FAILED',
      details: lastError instanceof Error ? lastError.message : String(lastError),
    };
  }

  /**
   * Endpoint to send interactive rating buttons via WhatsApp
   * Called from Vercel when booking is completed to request customer feedback
   */
  @Public()
  @Post('send-rating-buttons')
  @HttpCode(HttpStatus.OK)
  async sendRatingButtons(
    @Headers('x-bot-secret') botSecret: string,
    @Body() body: { phoneNumber: string; bookingId?: string },
  ) {
    // Verify bot secret
    if (!this.botIntegrationService.verifyBotSecret(botSecret)) {
      this.logger.warn('Invalid bot secret in send-rating-buttons request');
      throw new BadRequestException('Invalid bot secret');
    }

    const { phoneNumber, bookingId } = body;

    if (!phoneNumber) {
      throw new BadRequestException('Phone number is required');
    }

    this.logger.log(`[sendRatingButtons] Request received for ${phoneNumber}, bookingId: ${bookingId}`);

    // Get the first active session
    const sessions = await this.sessionService.findAll(null, { limit: 10 });
    const readySession = sessions.find(s => s.status === 'ready');

    if (!readySession) {
      this.logger.warn('No active WhatsApp session found when attempting to send rating buttons');
      return {
        success: false,
        message: 'WhatsApp Bot is offline/disconnected. Please check bot session',
        error: 'NO_ACTIVE_SESSION',
      };
    }

    const formattedPhone = this.botIntegrationService.cleanPhoneNumber(phoneNumber);

    // Get all phone number variations for fallback
    const phoneVariations = this.botIntegrationService.getPhoneNumberVariations(phoneNumber);
    let lastError = null;

    // Try each variation until one succeeds
    for (const phoneVar of phoneVariations) {
      try {
        const phoneForWhatsApp = phoneVar.replace('+', '');

        // Send interactive rating buttons
        const ratingButtons = [
          { id: 'rating_1', text: '⭐ 1' },
          { id: 'rating_2', text: '⭐⭐ 2' },
          { id: 'rating_3', text: '⭐⭐⭐ 3' },
          { id: 'rating_4', text: '⭐⭐⭐⭐ 4' },
          { id: 'rating_5', text: '⭐⭐⭐⭐⭐ 5' },
        ];

        const message = `كيف كانت تجربتك معنا؟ 🌟\n\nيرجى اختيار تقييمك من القائمة أدناه`;

        // For now, send as text message with button options listed
        // Interactive buttons require deeper integration with the Baileys library
        await this.messageService.sendText(readySession.id, {
          chatId: `${phoneForWhatsApp}@c.us`,
          text: `${message}\n\n${ratingButtons.map(b => b.text).join('\n')}\n\nBooking ID: ${bookingId || 'N/A'}`,
        });

        this.logger.log(`[sendRatingButtons] Rating request sent to ${phoneVar} via session ${readySession.id}`);

        return {
          success: true,
          message: 'Rating request sent successfully',
          phoneUsed: phoneVar,
        };
      } catch (error) {
        lastError = error;
        this.logger.warn(`[sendRatingButtons] Failed to send rating request to ${phoneVar}, trying next variation...`);
        continue;
      }
    }

    // All variations failed
    this.logger.error(`[sendRatingButtons] Failed to send rating request with all phone variations for ${phoneNumber}`);
    return {
      success: false,
      message: 'Failed to send rating request via WhatsApp. The phone number may not be registered on WhatsApp.',
      error: 'SEND_FAILED',
      details: lastError instanceof Error ? lastError.message : String(lastError),
    };
  }

  /**
   * Endpoint to handle incoming rating response from WhatsApp
   * Called when a customer replies with a rating (1-5) or taps a rating button
   */
  @Public()
  @Post('customer-rating-response')
  @HttpCode(HttpStatus.OK)
  async handleCustomerRatingResponse(
    @Headers('x-bot-secret') botSecret: string,
    @Body() body: { phoneNumber: string; rating: string; comment?: string; bookingId?: string; buttonId?: string },
  ) {
    // Verify bot secret
    if (!this.botIntegrationService.verifyBotSecret(botSecret)) {
      this.logger.warn('Invalid bot secret in customer-rating-response request');
      throw new BadRequestException('Invalid bot secret');
    }

    const { phoneNumber, rating, comment, bookingId, buttonId } = body;

    this.logger.log(`[customer-rating-response] Received rating response`, {
      phoneNumber,
      rating,
      buttonId,
      bookingId,
    });

    // Extract rating from buttonId if provided (e.g., "rating_5" -> 5)
    let ratingNum = rating ? parseInt(rating) : null;
    if (buttonId && buttonId.startsWith('rating_')) {
      ratingNum = parseInt(buttonId.replace('rating_', ''));
      this.logger.log(`[customer-rating-response] Extracted rating from buttonId: ${ratingNum}`);
    }

    if (!phoneNumber || !ratingNum) {
      this.logger.warn('[customer-rating-response] Missing phone number or rating');
      throw new BadRequestException('Phone number and rating are required');
    }

    // Validate rating is between 1 and 5
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      this.logger.warn(`[customer-rating-response] Invalid rating: ${ratingNum}`);
      throw new BadRequestException('Rating must be between 1 and 5');
    }

    // Forward to Vercel customer-rating endpoint
    try {
      const vercelUrl = this.configService.get<string>('VERCEL_API_URL');
      const vercelSecret = this.configService.get<string>('BOT_SECRET');

      if (!vercelUrl || !vercelSecret) {
        this.logger.error('[customer-rating-response] VERCEL_API_URL or BOT_SECRET not configured');
        return {
          success: false,
          message: 'Vercel integration not configured',
        };
      }

      this.logger.log(`[customer-rating-response] Forwarding rating to Vercel`, {
        vercelUrl,
        rating: ratingNum,
      });

      const vercelResponse = await fetch(`${vercelUrl}/api/bot-integration/customer-rating`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Bot-Secret': vercelSecret,
        },
        body: JSON.stringify({
          phoneNumber,
          rating: ratingNum,
          comment: comment || null,
          bookingId: bookingId || null,
        }),
      });

      if (!vercelResponse.ok) {
        const errorText = await vercelResponse.text();
        this.logger.error(`[customer-rating-response] Failed to forward rating to Vercel`, {
          status: vercelResponse.status,
          error: errorText,
        });
        return {
          success: false,
          message: 'Failed to forward rating to Vercel',
          error: errorText,
        };
      }

      const vercelData = await vercelResponse.json();
      this.logger.log(`[customer-rating-response] Rating ${ratingNum} from ${phoneNumber} forwarded to Vercel successfully`, {
        reviewId: vercelData.reviewId,
      });

      return {
        success: true,
        message: 'Rating recorded successfully',
        reviewId: vercelData.reviewId,
      };
    } catch (error) {
      this.logger.error('[customer-rating-response] Error forwarding rating to Vercel', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        success: false,
        message: 'Error forwarding rating to Vercel',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Internal handler for button tap events from WhatsApp
   * This is called by the message projector when a button tap is detected
   */
  async handleButtonTap(sessionId: string, chatId: string, buttonId: string, phoneNumber: string): Promise<void> {
    this.logger.log(`[handleButtonTap] Button tap detected`, {
      sessionId,
      chatId,
      buttonId,
      phoneNumber,
    });

    // Check if this is a rating button
    if (buttonId && buttonId.startsWith('rating_')) {
      this.logger.log(`[handleButtonTap] Rating button tapped: ${buttonId}`);

      // Forward to the customer-rating-response endpoint
      try {
        const botSecret = this.getBotSecret();
        const response = await this.handleCustomerRatingResponse(
          botSecret,
          { phoneNumber, rating: '', buttonId },
        );

        if (response.success) {
          this.logger.log(`[handleButtonTap] Rating processed successfully`, {
            reviewId: response.reviewId,
          });
        } else {
          this.logger.warn(`[handleButtonTap] Rating processing failed`, {
            error: response.error,
          });
        }
      } catch (error) {
        this.logger.error('[handleButtonTap] Error processing rating button tap', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private getBotSecret(): string {
    const secret = this.configService.get<string>('BOT_SECRET');
    if (!secret) {
      throw new Error('BOT_SECRET is not configured');
    }
    return secret;
  }
}
