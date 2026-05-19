-- CreateTable
CREATE TABLE "user_saved_views" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "resource" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_saved_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_saved_views_user_id_resource_idx" ON "user_saved_views"("user_id", "resource");

-- AddForeignKey
ALTER TABLE "user_saved_views" ADD CONSTRAINT "user_saved_views_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
