-- Джура · автовідповідь в особистих чатах: галочка, затримка (с) і підказка на чат;
-- позначка на повідомленнях, які написала автовідповідь, а не власник.
ALTER TABLE "DzhuraChat" ADD COLUMN "autoReplyEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DzhuraChat" ADD COLUMN "autoReplyDelaySec" INTEGER NOT NULL DEFAULT 80;
ALTER TABLE "DzhuraChat" ADD COLUMN "autoReplyNote" TEXT;
ALTER TABLE "DzhuraMessage" ADD COLUMN "isAutoReply" BOOLEAN NOT NULL DEFAULT false;
