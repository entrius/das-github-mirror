import { CacheInterceptor } from "@nestjs/cache-manager";
import { ExecutionContext, Injectable } from "@nestjs/common";
import { NO_CACHE_KEY } from "./no-cache.decorator";

@Injectable()
export class CustomCacheInterceptor extends CacheInterceptor {
  protected isRequestCacheable(context: ExecutionContext): boolean {
    const noCache = this.reflector.get<boolean>(
      NO_CACHE_KEY,
      context.getHandler(),
    );
    if (noCache) return false;
    return super.isRequestCacheable(context);
  }
}
