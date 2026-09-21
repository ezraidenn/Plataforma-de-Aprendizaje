CREATE TABLE `assignment_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`item_id` text NOT NULL,
	`student_id` text NOT NULL,
	`file_id` text NOT NULL,
	`comment` text DEFAULT '' NOT NULL,
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
CREATE INDEX `submissions_item_idx` ON `assignment_submissions` (`item_id`);--> statement-breakpoint
CREATE INDEX `submissions_student_idx` ON `assignment_submissions` (`student_id`);--> statement-breakpoint
CREATE INDEX `submissions_status_idx` ON `assignment_submissions` (`status`);--> statement-breakpoint
CREATE TABLE `attempt_answers` (
	`id` text PRIMARY KEY NOT NULL,
	`attempt_id` text NOT NULL,
	`question_id` text NOT NULL,
	`selected_option_ids` text,
	`answer_text` text,
	`auto_points` real,
	`manual_points` real,
	`feedback_md` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`attempt_id`) REFERENCES `exam_attempts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attempt_answers_uq` ON `attempt_answers` (`attempt_id`,`question_id`);--> statement-breakpoint
CREATE INDEX `attempt_answers_attempt_idx` ON `attempt_answers` (`attempt_id`);--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text,
	`detail` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_log` (`entity`,`entity_id`);--> statement-breakpoint
CREATE TABLE `certificate_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`background_file_id` text,
	`fields` text DEFAULT '[]' NOT NULL,
	`page_size` text DEFAULT 'letter' NOT NULL,
	`orientation` text DEFAULT 'landscape' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`background_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cert_templates_owner_idx` ON `certificate_templates` (`owner_id`);--> statement-breakpoint
CREATE TABLE `certificates` (
	`id` text PRIMARY KEY NOT NULL,
	`folio` text NOT NULL,
	`enrollment_id` text NOT NULL,
	`student_id` text NOT NULL,
	`course_id` text NOT NULL,
	`issued_at` integer NOT NULL,
	`template_snapshot` text,
	`pdf_file_id` text,
	`verification_hash` text NOT NULL,
	`revoked` integer DEFAULT false NOT NULL,
	`revoked_reason` text,
	`revoked_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`enrollment_id`) REFERENCES `enrollments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pdf_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `certificates_folio_unique` ON `certificates` (`folio`);--> statement-breakpoint
CREATE INDEX `certificates_student_idx` ON `certificates` (`student_id`);--> statement-breakpoint
CREATE INDEX `certificates_course_idx` ON `certificates` (`course_id`);--> statement-breakpoint
CREATE TABLE `course_items` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`parent_id` text,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`sequence_mode` text DEFAULT 'inherit' NOT NULL,
	`required_for_completion` integer DEFAULT true NOT NULL,
	`visible` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `course_items_course_idx` ON `course_items` (`course_id`);--> statement-breakpoint
CREATE INDEX `course_items_parent_idx` ON `course_items` (`parent_id`,`position`);--> statement-breakpoint
CREATE TABLE `courses` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`cover_file_id` text,
	`owner_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`enforce_sequence` integer DEFAULT true NOT NULL,
	`completion_rules` text,
	`certificate_template_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`cover_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`owner_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `courses_owner_idx` ON `courses` (`owner_id`);--> statement-breakpoint
CREATE INDEX `courses_status_idx` ON `courses` (`status`);--> statement-breakpoint
CREATE TABLE `document_progress` (
	`item_progress_id` text PRIMARY KEY NOT NULL,
	`pages_viewed` blob,
	`current_page` integer DEFAULT 1 NOT NULL,
	`last_heartbeat_at` integer,
	`last_reported_page` integer,
	FOREIGN KEY (`item_progress_id`) REFERENCES `item_progress`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `enrollments` (
	`id` text PRIMARY KEY NOT NULL,
	`course_id` text NOT NULL,
	`student_id` text NOT NULL,
	`enrolled_by` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`course_id`) REFERENCES `courses`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`enrolled_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `enrollments_course_student_uq` ON `enrollments` (`course_id`,`student_id`);--> statement-breakpoint
CREATE INDEX `enrollments_student_idx` ON `enrollments` (`student_id`);--> statement-breakpoint
CREATE INDEX `enrollments_status_idx` ON `enrollments` (`course_id`,`status`);--> statement-breakpoint
CREATE TABLE `exam_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`exam_item_id` text NOT NULL,
	`student_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`started_at` integer NOT NULL,
	`deadline_at` integer,
	`submitted_at` integer,
	`auto_score` real,
	`manual_score` real,
	`final_score` real,
	`max_score_snapshot` real,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`graded_by` text,
	`graded_at` integer,
	`question_order` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`exam_item_id`) REFERENCES `exams`(`item_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`student_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`graded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `exam_attempts_uq` ON `exam_attempts` (`exam_item_id`,`student_id`,`attempt_number`);--> statement-breakpoint
CREATE INDEX `exam_attempts_student_idx` ON `exam_attempts` (`student_id`);--> statement-breakpoint
CREATE INDEX `exam_attempts_status_idx` ON `exam_attempts` (`status`);--> statement-breakpoint
CREATE TABLE `exams` (
	`item_id` text PRIMARY KEY NOT NULL,
	`instructions_md` text DEFAULT '' NOT NULL,
	`opens_at` integer,
	`closes_at` integer,
	`max_attempts` integer,
	`attempt_score_policy` text DEFAULT 'best' NOT NULL,
	`time_limit_minutes` integer,
	`pass_score` real,
	`shuffle_questions` integer DEFAULT false NOT NULL,
	`show_results_mode` text DEFAULT 'immediately' NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `course_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`original_name` text NOT NULL,
	`stored_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`uploaded_by` text NOT NULL,
	`kind` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`uploaded_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `files_kind_idx` ON `files` (`kind`);--> statement-breakpoint
CREATE INDEX `files_uploader_idx` ON `files` (`uploaded_by`);--> statement-breakpoint
CREATE TABLE `item_assignments` (
	`item_id` text PRIMARY KEY NOT NULL,
	`instructions_md` text DEFAULT '' NOT NULL,
	`due_at` integer,
	`max_score` integer DEFAULT 100 NOT NULL,
	`allowed_file_types` text DEFAULT '.pdf,.docx' NOT NULL,
	`allow_resubmission` integer DEFAULT true NOT NULL,
	`allow_late` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `course_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `item_documents` (
	`item_id` text PRIMARY KEY NOT NULL,
	`source_file_id` text,
	`render_file_id` text,
	`thumbnail_file_id` text,
	`source_type` text,
	`page_count` integer,
	`min_seconds_per_page` integer DEFAULT 3 NOT NULL,
	`processing_status` text DEFAULT 'pending' NOT NULL,
	`processing_error` text,
	FOREIGN KEY (`item_id`) REFERENCES `course_items`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`render_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`thumbnail_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `item_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`enrollment_id` text NOT NULL,
	`item_id` text NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`percent` real DEFAULT 0 NOT NULL,
	`completed_at` integer,
	`last_activity_at` integer,
	`total_seconds` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`enrollment_id`) REFERENCES `enrollments`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`item_id`) REFERENCES `course_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `item_progress_uq` ON `item_progress` (`enrollment_id`,`item_id`);--> statement-breakpoint
CREATE INDEX `item_progress_item_idx` ON `item_progress` (`item_id`);--> statement-breakpoint
CREATE TABLE `item_texts` (
	`item_id` text PRIMARY KEY NOT NULL,
	`content_md` text DEFAULT '' NOT NULL,
	`min_read_seconds` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `course_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `item_videos` (
	`item_id` text PRIMARY KEY NOT NULL,
	`url` text NOT NULL,
	`provider` text NOT NULL,
	`video_id` text,
	`duration_seconds` integer,
	`allow_speed_up` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`item_id`) REFERENCES `course_items`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error_message` text,
	`run_after` integer,
	`started_at` integer,
	`finished_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `jobs_status_idx` ON `jobs` (`status`,`run_after`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`read_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`read_at`);--> statement-breakpoint
CREATE TABLE `question_options` (
	`id` text PRIMARY KEY NOT NULL,
	`question_id` text NOT NULL,
	`position` integer NOT NULL,
	`text_md` text NOT NULL,
	`is_correct` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`question_id`) REFERENCES `questions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `question_options_q_idx` ON `question_options` (`question_id`,`position`);--> statement-breakpoint
CREATE TABLE `questions` (
	`id` text PRIMARY KEY NOT NULL,
	`exam_item_id` text NOT NULL,
	`position` integer NOT NULL,
	`type` text NOT NULL,
	`prompt_md` text NOT NULL,
	`points` real DEFAULT 1 NOT NULL,
	`image_file_id` text,
	`config` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`exam_item_id`) REFERENCES `exams`(`item_id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`image_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `questions_exam_idx` ON `questions` (`exam_item_id`,`position`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`ip` text,
	`user_agent` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE INDEX `sessions_expires_idx` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`full_name` text NOT NULL,
	`role` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	`created_by` text,
	`last_login_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE INDEX `users_role_idx` ON `users` (`role`);--> statement-breakpoint
CREATE INDEX `users_active_idx` ON `users` (`active`);--> statement-breakpoint
CREATE TABLE `video_progress` (
	`item_progress_id` text PRIMARY KEY NOT NULL,
	`watched_intervals` text DEFAULT '[]' NOT NULL,
	`max_position` real DEFAULT 0 NOT NULL,
	`last_position` real DEFAULT 0 NOT NULL,
	`last_heartbeat_at` integer,
	FOREIGN KEY (`item_progress_id`) REFERENCES `item_progress`(`id`) ON UPDATE no action ON DELETE cascade
);
