import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request } from "express";

/**
 * Strict API key guard — rejects requests without a valid x-api-key header.
 * Use for admin/privileged endpoints. For public endpoints with rate limiting,
 * use ApiKeyGuard (which wraps throttling) instead.
 */
@Injectable()
export class RequireApiKeyGuard implements CanActivate {
  private readonly apiKeys: Set<string>;

  constructor(config: ConfigService) {
    const raw = config.get<string>("API_KEYS") ?? "";
    this.apiKeys = new Set(
      raw
        .split(",")
        .map((k) => k.trim())
        .filter(Boolean),
    );
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const key = req.headers["x-api-key"];

    if (this.apiKeys.size === 0) {
      throw new UnauthorizedException(
        "API key authentication is not configured",
      );
    }

    if (typeof key !== "string" || !this.apiKeys.has(key)) {
      throw new UnauthorizedException("Invalid or missing x-api-key header");
    }

    return true;
  }
}
