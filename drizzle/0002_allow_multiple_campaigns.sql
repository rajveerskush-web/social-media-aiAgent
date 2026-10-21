ALTER TABLE "campaign" DROP CONSTRAINT "campaign_auth_user_id_unique";--> statement-breakpoint
CREATE INDEX "campaign_auth_user_id_idx" ON "campaign" USING btree ("auth_user_id");