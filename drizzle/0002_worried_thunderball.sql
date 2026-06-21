CREATE TABLE "classification_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"classification" jsonb NOT NULL,
	"source" text NOT NULL,
	"model_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
