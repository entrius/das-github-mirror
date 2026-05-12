import {
  Controller,
  Post,
  Req,
  Headers,
  HttpCode,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import { WebhookService } from "./webhook.service";

@Controller("webhooks")
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);
  private readonly webhookSecret: string;

  constructor(
    private readonly webhookService: WebhookService,
    config: ConfigService,
  ) {
    this.webhookSecret = config.getOrThrow("GITHUB_WEBHOOK_SECRET");
  }

  @Post("github")
  @HttpCode(202)
  async handleWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers("x-hub-signature-256") signature: string | undefined,
    @Headers("x-github-delivery") deliveryId: string | undefined,
    @Headers("x-github-event") event: string | undefined,
  ): Promise<{ accepted: boolean }> {
    if (!signature || !deliveryId || !event) {
      throw new BadRequestException("Missing required GitHub webhook headers");
    }

    if (!req.rawBody) {
      throw new BadRequestException("Missing request body");
    }

    this.verifySignature(req.rawBody, signature);

    const shouldProcess = await this.webhookService.claimDelivery(deliveryId);
    if (!shouldProcess) {
      this.logger.debug(`Duplicate delivery ${deliveryId}, skipping`);
      return { accepted: false };
    }

    try {
      await this.webhookService.handleEvent(
        event,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        req.body as Record<string, any>,
        deliveryId,
      );

      // Only mark processed on handler success.
      await this.webhookService.markProcessed(deliveryId);
    } catch (err) {
      // Release the in-flight lease on failure so retries can proceed
      // immediately without waiting for lease expiry.
      await this.webhookService.releaseDelivery(deliveryId);
      throw err;
    }

    return { accepted: true };
  }

  private verifySignature(payload: Buffer, signature: string): void {
    const expected =
      "sha256=" +
      createHmac("sha256", this.webhookSecret).update(payload).digest("hex");

    const sig = Buffer.from(signature);
    const exp = Buffer.from(expected);

    if (sig.length !== exp.length || !timingSafeEqual(sig, exp)) {
      throw new BadRequestException("Invalid webhook signature");
    }
  }
}
