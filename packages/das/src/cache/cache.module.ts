import { CacheModule } from "@nestjs/cache-manager";
import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { redisStore } from "cache-manager-redis-yet";
import { CustomCacheInterceptor } from "./custom-cache.interceptor";

// Production TTL for cached API responses (scoring cycles run far less often)
const CACHE_TTL_MS = 60 * 1000; // 1 minute
// In dev we effectively disable caching for iteration speed
const DEV_CACHE_TTL_MS = 1;

const isProduction = process.env.NODE_ENV === "production";

@Global()
@Module({
  imports: [
    CacheModule.registerAsync({
      isGlobal: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      useFactory: async (): Promise<any> => {
        const ttl = isProduction ? CACHE_TTL_MS : DEV_CACHE_TTL_MS;

        if (process.env.REDIS_HOST) {
          return {
            store: await redisStore({
              socket: {
                host: process.env.REDIS_HOST,
                port: parseInt(process.env.REDIS_PORT ?? "6379"),
              },
              ttl,
            }),
          };
        }
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
