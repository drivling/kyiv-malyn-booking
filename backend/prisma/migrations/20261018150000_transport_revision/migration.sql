-- Журнал ревізій датасету міського транспорту (Docs/transport-revisions-2026-10.md): рядок на кожен запис, що
-- бампає TransportMeta.updatedAt. revision = ISO updatedAt (та сама, що в GET /transport/dataset і ETag),
-- stats — лічильники фіду (GtfsFeedStats), diff — що змінилось проти попереднього рядка (NULL у першого).
CREATE TABLE "TransportRevision" (
    "revision" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "stats" JSONB NOT NULL,
    "diff" JSONB,

    CONSTRAINT "TransportRevision_pkey" PRIMARY KEY ("revision")
);

CREATE INDEX "TransportRevision_createdAt_idx" ON "TransportRevision"("createdAt");
