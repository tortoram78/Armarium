CREATE TABLE "item_carry" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"capacity_liters" real,
	"capacity_liters_src" text,
	"suspension" text,
	"suspension_conf" text,
	"suspension_src" text,
	"max_comfortable_load_kg" real,
	"max_comfortable_load_conf" text,
	"max_comfortable_load_src" text
);
--> statement-breakpoint
CREATE TABLE "item_footwear" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"support_stiffness" integer,
	"support_stiffness_conf" text,
	"support_stiffness_src" text,
	"ankle_height" text,
	"ankle_height_conf" text,
	"ankle_height_src" text,
	"crampon_compat" text,
	"crampon_compat_src" text,
	"water_management" text,
	"water_management_conf" text,
	"water_management_src" text
);
--> statement-breakpoint
CREATE TABLE "item_insulation" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"fill_type" text,
	"fill_type_src" text,
	"fill_power" integer,
	"fill_power_src" text,
	"fill_species" text,
	"fill_species_src" text,
	"fill_weight_g" integer,
	"fill_weight_src" text,
	"hydrophobic_treatment" boolean,
	"hydrophobic_treatment_src" text,
	"wet_performance" text,
	"wet_performance_conf" text,
	"wet_performance_src" text,
	"warmth_for_weight" text,
	"warmth_for_weight_conf" text,
	"warmth_for_weight_src" text
);
--> statement-breakpoint
CREATE TABLE "item_shell" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"protection_ceiling" text,
	"protection_ceiling_conf" text,
	"protection_ceiling_src" text,
	"seam_sealing" text,
	"seam_sealing_src" text,
	"hood" boolean,
	"hood_src" text,
	"pit_zips" boolean,
	"pit_zips_src" text
);
--> statement-breakpoint
CREATE TABLE "item_sleep" (
	"item_id" uuid PRIMARY KEY NOT NULL,
	"temp_rating_value" integer,
	"temp_rating_value_src" text,
	"temp_rating_unit" text,
	"temp_rating_unit_src" text,
	"temp_rating_standard" text,
	"temp_rating_standard_conf" text,
	"temp_rating_standard_src" text,
	"shape" text,
	"shape_conf" text,
	"shape_src" text,
	"pad_r_value_recommended" real,
	"pad_r_value_conf" text,
	"pad_r_value_src" text
);
--> statement-breakpoint
CREATE TABLE "item_treatments" (
	"item_id" uuid NOT NULL,
	"treatment_id" uuid NOT NULL,
	"condition" text,
	CONSTRAINT "item_treatments_item_id_treatment_id_pk" PRIMARY KEY("item_id","treatment_id")
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"model" text,
	"price_cents" integer,
	"price_src" text,
	"weight_grams" integer,
	"weight_src" text,
	"upf" integer,
	"upf_src" text,
	"waterproofness" text,
	"waterproofness_conf" text,
	"waterproofness_src" text,
	"wind_resistance" text,
	"wind_resistance_conf" text,
	"wind_resistance_src" text,
	"breathability" text,
	"breathability_conf" text,
	"breathability_src" text,
	"moisture_management" text,
	"moisture_management_conf" text,
	"moisture_management_src" text,
	"dry_speed" text,
	"dry_speed_conf" text,
	"dry_speed_src" text,
	"warmth_when_wet" text,
	"warmth_when_wet_conf" text,
	"warmth_when_wet_src" text,
	"warmth" text,
	"warmth_conf" text,
	"warmth_src" text,
	"packability" text,
	"packability_conf" text,
	"packability_src" text,
	"technical_vs_lifestyle" text,
	"technical_vs_lifestyle_conf" text,
	"technical_vs_lifestyle_src" text,
	"layering_role" text[],
	"function_purpose" text[],
	"body_zone_covered" text[],
	"activity_fit" text[],
	"conditions_fit" text[],
	"facets" jsonb DEFAULT '{}'::jsonb,
	"shell_material_id" uuid,
	"membrane_material_id" uuid,
	"insulation_material_id" uuid,
	"lining_material_id" uuid,
	"raw_text" text,
	"in_inventory" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "materials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"fiber_components" jsonb,
	"construction_type" text,
	"behavior" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_facets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"item_id" uuid,
	"raw_key" text NOT NULL,
	"raw_value" jsonb,
	"evidence" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "treatments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"description" text
);
--> statement-breakpoint
CREATE TABLE "trips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"raw_description" text,
	"conditions" jsonb,
	"result_snapshot" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "item_carry" ADD CONSTRAINT "item_carry_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_footwear" ADD CONSTRAINT "item_footwear_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_insulation" ADD CONSTRAINT "item_insulation_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_shell" ADD CONSTRAINT "item_shell_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_sleep" ADD CONSTRAINT "item_sleep_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_treatments" ADD CONSTRAINT "item_treatments_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item_treatments" ADD CONSTRAINT "item_treatments_treatment_id_treatments_id_fk" FOREIGN KEY ("treatment_id") REFERENCES "public"."treatments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_shell_material_id_materials_id_fk" FOREIGN KEY ("shell_material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_membrane_material_id_materials_id_fk" FOREIGN KEY ("membrane_material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_insulation_material_id_materials_id_fk" FOREIGN KEY ("insulation_material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_lining_material_id_materials_id_fk" FOREIGN KEY ("lining_material_id") REFERENCES "public"."materials"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_facets" ADD CONSTRAINT "pending_facets_item_id_items_id_fk" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "items_user_idx" ON "items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "items_layering_role_idx" ON "items" USING gin ("layering_role");--> statement-breakpoint
CREATE INDEX "items_function_purpose_idx" ON "items" USING gin ("function_purpose");--> statement-breakpoint
CREATE INDEX "items_facets_idx" ON "items" USING gin ("facets");