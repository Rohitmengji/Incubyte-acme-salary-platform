-- CreateIndex
CREATE INDEX "import_batch_status_expires_at_idx" ON "import_batch"("status", "expires_at");

-- CreateIndex
CREATE INDEX "import_batch_file_sha256_status_idx" ON "import_batch"("file_sha256", "status");
