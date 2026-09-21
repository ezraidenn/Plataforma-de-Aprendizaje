ALTER TABLE `cohorts` ADD `course_id` text REFERENCES courses(id) ON DELETE cascade;--> statement-breakpoint
CREATE INDEX `cohorts_course_idx` ON `cohorts` (`course_id`);--> statement-breakpoint
-- Relleno: los grupos pasan a ser de un curso. Cada grupo se queda en el curso
-- donde tiene más matrículas; por cada curso adicional se crea una copia con
-- el mismo nombre y sus matrículas de ese curso se reasignan a la copia.
CREATE TEMP TABLE `_cohort_courses` AS
  SELECT `cohort_id`, `course_id`, COUNT(*) AS `n`
  FROM `enrollments` WHERE `cohort_id` IS NOT NULL
  GROUP BY `cohort_id`, `course_id`;--> statement-breakpoint
UPDATE `cohorts` SET `course_id` = (
  SELECT cc.`course_id` FROM `_cohort_courses` cc
  WHERE cc.`cohort_id` = `cohorts`.`id`
  ORDER BY cc.`n` DESC, cc.`course_id` LIMIT 1
);--> statement-breakpoint
CREATE TEMP TABLE `_cohort_splits` AS
  SELECT cc.`cohort_id` AS `old_id`, cc.`course_id`, lower(hex(randomblob(11))) AS `new_id`
  FROM `_cohort_courses` cc JOIN `cohorts` c ON c.`id` = cc.`cohort_id`
  WHERE cc.`course_id` != c.`course_id`;--> statement-breakpoint
INSERT INTO `cohorts` (`id`, `course_id`, `name`, `status`, `created_by`, `closed_at`, `created_at`, `updated_at`)
  SELECT s.`new_id`, s.`course_id`, c.`name`, c.`status`, c.`created_by`, c.`closed_at`, c.`created_at`, c.`updated_at`
  FROM `_cohort_splits` s JOIN `cohorts` c ON c.`id` = s.`old_id`;--> statement-breakpoint
UPDATE `enrollments` SET `cohort_id` = (
  SELECT s.`new_id` FROM `_cohort_splits` s
  WHERE s.`old_id` = `enrollments`.`cohort_id` AND s.`course_id` = `enrollments`.`course_id`
)
WHERE EXISTS (
  SELECT 1 FROM `_cohort_splits` s
  WHERE s.`old_id` = `enrollments`.`cohort_id` AND s.`course_id` = `enrollments`.`course_id`
);--> statement-breakpoint
-- Grupos sin ninguna matrícula: no pertenecen a ningún curso y no guardan nada
DELETE FROM `cohorts` WHERE `course_id` IS NULL;--> statement-breakpoint
DROP TABLE `_cohort_splits`;--> statement-breakpoint
DROP TABLE `_cohort_courses`;
