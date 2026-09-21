CREATE TABLE `assignment_attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`file_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `course_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `assignment_attachments_item_idx` ON `assignment_attachments` (`item_id`,`position`);--> statement-breakpoint
CREATE TABLE `item_links` (
	`item_id` text PRIMARY KEY NOT NULL,
	`url` text DEFAULT '' NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `course_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `item_resource_files` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`file_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `course_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `item_resource_files_item_idx` ON `item_resource_files` (`item_id`,`position`);--> statement-breakpoint
CREATE TABLE `submission_files` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`file_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `assignment_submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `submission_files_sub_idx` ON `submission_files` (`submission_id`,`position`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_assignment_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`student_id` text NOT NULL,
	`file_id` text,
	`comment` text DEFAULT '' NOT NULL,
	`answer_text` text DEFAULT '' NOT NULL,
	`submitted_at` integer NOT NULL,
	`is_late` integer DEFAULT false NOT NULL,
	`score` real,
	`feedback_md` text,
	`status` text DEFAULT 'submitted' NOT NULL,
	`graded_by` text,
	`graded_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `item_assignments`(`item_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`graded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_assignment_submissions`("id", "item_id", "student_id", "file_id", "comment", "answer_text", "submitted_at", "is_late", "score", "feedback_md", "status", "graded_by", "graded_at", "created_at", "updated_at") SELECT "id", "item_id", "student_id", "file_id", "comment", '' AS "answer_text", "submitted_at", "is_late", "score", "feedback_md", "status", "graded_by", "graded_at", "created_at", "updated_at" FROM `assignment_submissions`;--> statement-breakpoint
DROP TABLE `assignment_submissions`;--> statement-breakpoint
ALTER TABLE `__new_assignment_submissions` RENAME TO `assignment_submissions`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `submissions_item_idx` ON `assignment_submissions` (`item_id`);--> statement-breakpoint
CREATE INDEX `submissions_student_idx` ON `assignment_submissions` (`student_id`);--> statement-breakpoint
CREATE INDEX `submissions_status_idx` ON `assignment_submissions` (`status`);--> statement-breakpoint
ALTER TABLE `users` ADD `can_edit_branding` integer DEFAULT false NOT NULL;