import { ExecutionContext, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from "@nestjs/throttler";
import { Reflector } from "@nestjs/core";
import { Request } from "express";

/**
 * Guard that enforces a strict per-IP rate limit for unauthenticated requests
 * and skips throttling entirely when a valid x-api-key header is present.
 *
 * Validators (and anyone with an API key) get unlimited access.
 * Anonymous callers get a strict ceiling (see ThrottlerModule config in app module).
 */
@Injectable()
export class ApiKeyGuard extends ThrottlerGuard {
  private readonly apiKeys: Set<string>;

  constructor(
    options: ThrottlerModuleOptions,
    storage: ThrottlerStorage,
    reflector: Reflector,
    config: ConfigService,
  ) {
    super(options, storage, reflector);
    const raw = config.get<string>("API_KEYS") ?? "";
    this.apiKeys = new Set(
      raw
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
    );
  }

  protected shouldSkip(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const key = req.headers["x-api-key"];

    if (typeof key === "string" && this.apiKeys.has(key)) {
      return Promise.resolve(true); // Valid API key — no rate limit
    }

    return Promise.resolve(false); // Enforce throttle for anonymous traffic
  }
}
