CREATE INDEX `assignment_attachments_file_idx` ON `assignment_attachments` (`file_id`);--> statement-breakpoint
CREATE INDEX `submissions_file_idx` ON `assignment_submissions` (`file_id`);--> statement-breakpoint
CREATE INDEX `cert_templates_background_idx` ON `certificate_templates` (`background_file_id`);--> statement-breakpoint
CREATE INDEX `certificates_pdf_idx` ON `certificates` (`pdf_file_id`);--> statement-breakpoint
CREATE INDEX `item_documents_source_idx` ON `item_documents` (`source_file_id`);--> statement-breakpoint
CREATE INDEX `item_documents_render_idx` ON `item_documents` (`render_file_id`);--> statement-breakpoint
CREATE INDEX `item_documents_thumbnail_idx` ON `item_documents` (`thumbnail_file_id`);--> statement-breakpoint
CREATE INDEX `item_resource_files_file_idx` ON `item_resource_files` (`file_id`);--> statement-breakpoint
CREATE INDEX `questions_image_idx` ON `questions` (`image_file_id`);--> statement-breakpoint
CREATE INDEX `submission_files_file_idx` ON `submission_files` (`file_id`);