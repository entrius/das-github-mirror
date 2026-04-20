import { SetMetadata } from "@nestjs/common";

export const NO_CACHE_KEY = "no-cache";
export const NoCache = (): MethodDecorator & ClassDecorator =>
  SetMetadata(NO_CACHE_KEY, true);
