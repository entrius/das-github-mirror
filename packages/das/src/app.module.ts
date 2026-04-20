import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { CustomCacheModule } from "./cache";
import { DbModule } from "./config/database.config";
import { QueueModule } from "./queue/queue.module";
import { WebhookModule } from "./webhook/webhook.module";
import { ApiModule } from "./api/api.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env"],
    }),
    CustomCacheModule,
    DbModule,
    QueueModule,
    WebhookModule,
    ApiModule,
  ],
})
export class AppModule {}
