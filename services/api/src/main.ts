import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import { AppModule } from "./app.module.js";

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ bodyLimit: 10 * 1024 * 1024 }));
  app.setGlobalPrefix("api/v1");
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
  SwaggerModule.setup("api/docs", app, () => SwaggerModule.createDocument(app, swaggerConfig));

  await app.listen(Number(process.env.PORT ?? 3001), "0.0.0.0");
}

void bootstrap();
