CREATE TABLE `ai_exports` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`file_name` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `ai_conversations`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_exports_expires_idx` ON `ai_exports` (`expires_at`);