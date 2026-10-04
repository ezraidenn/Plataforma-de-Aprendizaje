CREATE TABLE `account_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`purpose` text NOT NULL,
	`expires_at` integer,
	`used_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_tokens_user_idx` ON `account_tokens` (`user_id`,`purpose`);--> statement-breakpoint
CREATE TABLE `email_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`kind` text NOT NULL,
	`ref` text DEFAULT '' NOT NULL,
	`to_address` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'pendiente' NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`run_after` integer,
	`provider_id` text,
	`error` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `email_log_user_idx` ON `email_log` (`user_id`,`kind`,`ref`);--> statement-breakpoint
CREATE INDEX `email_log_created_idx` ON `email_log` (`created_at`);--> statement-breakpoint
CREATE INDEX `email_log_status_idx` ON `email_log` (`status`,`run_after`);--> statement-breakpoint
ALTER TABLE `users` ADD `mail_reminders` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `mail_expiry` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `mail_notices` integer DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD `mail_digest` integer DEFAULT true NOT NULL;