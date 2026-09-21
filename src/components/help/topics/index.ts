import { ADMIN_TOPICS, type AdminValues } from "./admin";
import { ASSIGNMENT_TOPICS, type AssignmentValues } from "./assignment";
import { CERTIFICATES_TOPICS, type CertificatesValues } from "./certificates";
import { COURSE_TOPICS, type CourseValues } from "./course";
import { CONTENT_TOPICS, type ContentValues } from "./content";
import { EXAM_TOPICS, type ExamValues } from "./exam";
import { PEOPLE_TOPICS, type PeopleValues } from "./people";
import { RULES_TOPICS, type RulesValues } from "./rules";
import type { Topic, TopicsOf } from "./types";

/**
 * Temas de la ayuda visual (tooltips animados), por área. Solo datos y textos:
 * la escena de cada tema vive en scenes/ y se carga al abrir el tooltip
 * (registry.ts). Las frases marcan las negritas con **dobles asteriscos**.
 */
export type HelpValues = CourseValues &
  RulesValues &
  ContentValues &
  ExamValues &
  AssignmentValues &
  PeopleValues &
  CertificatesValues &
  AdminValues;
export type HelpTopicId = keyof HelpValues;
export type HelpTopic<K extends HelpTopicId> = Topic<HelpValues[K]>;
export type { NoValue } from "./types";

export const HELP_TOPICS: TopicsOf<HelpValues> = {
  ...COURSE_TOPICS,
  ...RULES_TOPICS,
  ...CONTENT_TOPICS,
  ...EXAM_TOPICS,
  ...ASSIGNMENT_TOPICS,
  ...PEOPLE_TOPICS,
  ...CERTIFICATES_TOPICS,
  ...ADMIN_TOPICS,
};
