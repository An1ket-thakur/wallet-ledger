import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { WebhooksService } from './webhooks.service';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';

/**
 * @Public(): webhooks are authenticated by HMAC signature, not a user's JWT -
 * the provider calling this endpoint has no Claude/user session at all.
 */
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Public()
  @Post('payment-provider')
  async handle(
    @Req() req: Request,
    @Body() dto: PaymentWebhookDto,
    @Headers('x-webhook-signature') signature: string | undefined,
  ) {
    // req.rawBody is populated by RawBodyMiddleware, mounted on this route only.
    this.webhooksService.verifySignature(req.rawBody as Buffer, signature);

    switch (dto.type) {
      case 'payment.succeeded':
        return this.webhooksService.handlePaymentSucceeded(dto);
      default:
        return { status: 'ignored' };
    }
  }
}
