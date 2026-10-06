import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ bodyLimit: 10 * 1024 * 1024 }));
  // URL prefixes are configurable so the API can live under a sub-path
  // (e.g. API_PREFIX=kuntorastit/api/v1) without a rewriting reverse proxy.
  const apiPrefix = trimSlashes(process.env.API_PREFIX ?? "api/v1");
  const docsPath = trimSlashes(process.env.API_DOCS_PATH ?? "api/docs");
  app.setGlobalPrefix(apiPrefix);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({
    origin: true,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle("Kuntorastien API")
    .setVersion("1.0")
    .addBearerAuth()
    .build();
  SwaggerModule.setup(docsPath, app, () => SwaggerModule.createDocument(app, swaggerConfig));

  await app.listen(Number(process.env.PORT ?? 3001), "0.0.0.0");
}

function trimSlashes(value: string) {
  return value.trim().replace(/\/{2,}/g, "/").replace(/^\/+|\/+$/g, "");
}

void bootstrap();
