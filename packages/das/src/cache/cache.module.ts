import { CacheModule, CacheModuleOptions } from "@nestjs/cache-manager";
import { Global, Logger, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import KeyvRedis from "@keyv/redis";
import { Keyv } from "keyv";
import { CustomCacheInterceptor } from "./custom-cache.interceptor";

// Production TTL for cached API responses (scoring cycles run far less often)
const CACHE_TTL_MS = 60 * 1000; // 1 minute
// In dev we effectively disable caching for iteration speed
const DEV_CACHE_TTL_MS = 1;

const isProduction = process.env.NODE_ENV === "production";

const logger = new Logger("CustomCacheModule");

@Global()
@Module({
  imports: [
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: (): CacheModuleOptions => {
        const ttl = isProduction ? CACHE_TTL_MS : DEV_CACHE_TTL_MS;

        // @nestjs/cache-manager v3 (cache-manager v7 / Keyv) reads the store
        // list from `stores` (plural — Keyv instances) and the entry TTL from
        // the top-level `ttl`. A singular `store`, or a `ttl` nested inside a
        // store adapter, is silently ignored: the cache then falls back to an
        // in-memory store with no expiry. Keep both at the top level.
        if (process.env.REDIS_HOST) {
          const host = process.env.REDIS_HOST;
          const port = process.env.REDIS_PORT ?? "6379";

          // `apicache` namespace keeps response-cache keys clear of the
          // BullMQ (`bull:*`) keyspace on the shared Redis instance.
          const store = new Keyv({
            store: new KeyvRedis(`redis://${host}:${port}`),
            namespace: "apicache",
          });
          // Surface — and swallow — Redis connection errors so a Redis blip
          // degrades to an uncached request rather than an unhandled
          // EventEmitter "error" that would crash the process.
          store.on("error", (err) =>
            logger.error(`Redis response cache error: ${String(err)}`),
          );

          return { ttl, stores: [store] };
        }

        // No Redis configured — fall back to the built-in in-memory store.
        return { ttl };
      },
    }),
  ],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: CustomCacheInterceptor,
    },
  ],
})
export class CustomCacheModule {}
