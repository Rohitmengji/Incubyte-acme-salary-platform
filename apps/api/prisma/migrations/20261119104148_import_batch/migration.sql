-- CreateEnum
CREATE TYPE "import_status" AS ENUM ('PREVIEWED', 'COMMITTED');

-- CreateTable
CREATE TABLE "import_batch" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "uploaded_by_id" UUID NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "file_sha256" CHAR(64) NOT NULL,
    "status" "import_status" NOT NULL DEFAULT 'PREVIEWED',
    "total_rows" INTEGER NOT NULL,
    "valid_rows" INTEGER NOT NULL,
    "invalid_rows" INTEGER NOT NULL,
    "duplicate_rows" INTEGER NOT NULL,
    "valid_payload" JSONB NOT NULL,
    "row_errors" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "committed_at" TIMESTAMPTZ(3),

    CONSTRAINT "import_batch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_batch_uploaded_by_id_created_at_idx" ON "import_batch"("uploaded_by_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "import_batch" ADD CONSTRAINT "import_batch_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "app_user"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
