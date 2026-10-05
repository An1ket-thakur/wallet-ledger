import { Body, Controller, Headers, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { WebhooksService } from './webhooks.service';
import { PaymentWebhookDto } from './dto/payment-webhook.dto';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooksService: WebhooksService) {}

  @Public()
  @Post('payment-provider')
  async handle(
    @Req() req: Request,
    @Body() dto: PaymentWebhookDto,
    @Headers('x-webhook-signature') signature: string | undefined,
    @Headers('x-webhook-timestamp') timestamp: string | undefined,
  ) {
    this.webhooksService.verifySignature(
      req.rawBody as Buffer,
      signature,
      timestamp,
    );

    switch (dto.type) {
      case 'payment.succeeded':
        return this.webhooksService.handlePaymentSucceeded(dto);
      default:
        return { status: 'ignored' };
    }
  }
}
