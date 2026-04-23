import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: "postgres",
        host: config.getOrThrow("DB_HOST"),
        port: +config.getOrThrow("DB_PORT"),
        username: config.getOrThrow("DB_USERNAME"),
        password: config.getOrThrow("DB_PASSWORD"),
        database: config.getOrThrow("DB_NAME"),
        entities: [`${__dirname}/../entities/**/*.entity.{js,ts}`],
        synchronize: false,
        // API + 5 fetch workers + backfill fanout can all contend. 20 gives
        // headroom without overwhelming Postgres's default max_connections=100.
        extra: {
          max: 20,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 10_000,
        },
      }),
    }),
  ],
})
export class DbModule {}
