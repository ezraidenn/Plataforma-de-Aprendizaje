PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_ai_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`file_name` text NOT NULL,
	`content` text,
	`file_id` text,
	`mime` text DEFAULT 'text/csv' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
-- Corregido a mano: drizzle-kit copiaba «file_id» y «mime» desde la tabla
-- vieja, que todavía no los tiene. Las descargas que ya existan son CSV.
INSERT INTO `__new_ai_exports`("id", "conversation_id", "file_name", "content", "file_id", "mime", "created_at", "expires_at") SELECT "id", "conversation_id", "file_name", "content", NULL, 'text/csv', "created_at", "expires_at" FROM `ai_exports`;--> statement-breakpoint
DROP TABLE `ai_exports`;--> statement-breakpoint
ALTER TABLE `__new_ai_exports` RENAME TO `ai_exports`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `ai_exports_expires_idx` ON `ai_exports` (`expires_at`);