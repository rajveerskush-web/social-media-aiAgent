CREATE TABLE "campaign" (
	"id" serial PRIMARY KEY NOT NULL,
	"auth_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"icon_key" text,
	"icon_image" "bytea",
	"icon_image_mime" text,
	"office_image" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_auth_user_id_unique" UNIQUE("auth_user_id")
);
--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_auth_user_id_users_auth_user_id_fk" FOREIGN KEY ("auth_user_id") REFERENCES "public"."users"("auth_user_id") ON DELETE cascade ON UPDATE no action;