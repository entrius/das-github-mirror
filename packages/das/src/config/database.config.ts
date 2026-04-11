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
      }),
    }),
  ],
})
export class DbModule {}
