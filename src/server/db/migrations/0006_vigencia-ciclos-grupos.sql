CREATE TABLE `cohorts` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`created_by` text NOT NULL,
	`closed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`created_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `cohorts_status_idx` ON `cohorts` (`status`);--> statement-breakpoint
DROP INDEX `enrollments_course_student_uq`;--> statement-breakpoint
ALTER TABLE `enrollments` ADD `cycle` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `enrollments` ADD `dropped_at` integer;--> statement-breakpoint
ALTER TABLE `enrollments` ADD `dropped_by` text REFERENCES users(id);--> statement-breakpoint
ALTER TABLE `enrollments` ADD `dropped_from` text;--> statement-breakpoint
ALTER TABLE `enrollments` ADD `cohort_id` text REFERENCES cohorts(id) ON DELETE set null;--> statement-breakpoint
CREATE UNIQUE INDEX `enrollments_course_student_cycle_uq` ON `enrollments` (`course_id`,`student_id`,`cycle`);--> statement-breakpoint
CREATE INDEX `enrollments_cohort_idx` ON `enrollments` (`cohort_id`);--> statement-breakpoint
DROP INDEX `exam_attempts_uq`;--> statement-breakpoint
ALTER TABLE `exam_attempts` ADD `enrollment_id` text REFERENCES enrollments(id) ON DELETE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX `exam_attempts_enrollment_uq` ON `exam_attempts` (`exam_item_id`,`enrollment_id`,`attempt_number`);--> statement-breakpoint
CREATE INDEX `exam_attempts_enrollment_idx` ON `exam_attempts` (`enrollment_id`);--> statement-breakpoint
ALTER TABLE `assignment_submissions` ADD `enrollment_id` text REFERENCES enrollments(id) ON DELETE cascade;--> statement-breakpoint
ALTER TABLE `certificates` ADD `expires_at` integer;--> statement-breakpoint
ALTER TABLE `certificates` ADD `renewal_state` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `certificates` ADD `renewal_note` text;--> statement-breakpoint
ALTER TABLE `certificates` ADD `renewal_at` integer;--> statement-breakpoint
ALTER TABLE `certificates` ADD `renewed_enrollment_id` text;--> statement-breakpoint
ALTER TABLE `courses` ADD `validity_mode` text DEFAULT 'lifetime' NOT NULL;--> statement-breakpoint
ALTER TABLE `courses` ADD `validity_months` integer;--> statement-breakpoint
-- Relleno: hasta hoy la matrícula era 1:1 con curso+alumno, así que cada intento
-- y cada entrega pertenece a la única matrícula de ese alumno en ese curso.
UPDATE `exam_attempts` SET `enrollment_id` = (
  SELECT e.`id` FROM `enrollments` e
  JOIN `course_items` ci ON ci.`course_id` = e.`course_id`
  WHERE ci.`id` = `exam_attempts`.`exam_item_id` AND e.`student_id` = `exam_attempts`.`student_id`
  LIMIT 1
) WHERE `enrollment_id` IS NULL;--> statement-breakpoint
UPDATE `assignment_submissions` SET `enrollment_id` = (
  SELECT e.`id` FROM `enrollments` e
  JOIN `course_items` ci ON ci.`course_id` = e.`course_id`
  WHERE ci.`id` = `assignment_submissions`.`item_id` AND e.`student_id` = `assignment_submissions`.`student_id`
  LIMIT 1
) WHERE `enrollment_id` IS NULL;--> statement-breakpoint
-- Las bajas existentes se asumen hechas desde «en curso»
UPDATE `enrollments` SET `dropped_from` = 'active' WHERE `status` = 'dropped' AND `dropped_from` IS NULL;
