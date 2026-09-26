import { lazy, type ComponentType, type LazyExoticComponent } from "react";
import type { HelpTopicId, HelpValues } from "./topics";

type SceneMap = {
  [K in HelpTopicId]: LazyExoticComponent<ComponentType<{ value: HelpValues[K] }>>;
};

/**
 * Escena de cada tema, descargada la primera vez que se abre su tooltip: las
 * pantallas no cargan escenas que nadie mira. Una línea por tema.
 */
export const SCENES: SceneMap = {
  "course.status": lazy(() => import("./scenes/course").then((m) => ({ default: m.StatusScene }))),
  "course.sequential": lazy(() => import("./scenes/course").then((m) => ({ default: m.SequentialScene }))),
  "course.cover": lazy(() => import("./scenes/course").then((m) => ({ default: m.CoverScene }))),
  "course.certificate": lazy(() => import("./scenes/course").then((m) => ({ default: m.CertificateScene }))),
  "course.validity": lazy(() => import("./scenes/course").then((m) => ({ default: m.ValidityScene }))),
  "rules.operator": lazy(() => import("./scenes/rules").then((m) => ({ default: m.OperatorScene }))),
  "rules.viewing": lazy(() => import("./scenes/rules").then((m) => ({ default: m.ViewingScene }))),
  "rules.examAverage": lazy(() => import("./scenes/rules").then((m) => ({ default: m.ExamAverageScene }))),
  "rules.examSpecific": lazy(() => import("./scenes/rules").then((m) => ({ default: m.ExamSpecificScene }))),
  "rules.allItems": lazy(() => import("./scenes/rules").then((m) => ({ default: m.AllItemsScene }))),
  "content.types": lazy(() => import("./scenes/content-types").then((m) => ({ default: m.TypesScene }))),
  "content.docSeconds": lazy(() => import("./scenes/content").then((m) => ({ default: m.DocSecondsScene }))),
  "content.textSeconds": lazy(() => import("./scenes/content").then((m) => ({ default: m.TextSecondsScene }))),
  "content.videoSpeed": lazy(() => import("./scenes/video").then((m) => ({ default: m.VideoSpeedScene }))),
  "content.required": lazy(() => import("./scenes/content").then((m) => ({ default: m.RequiredScene }))),
  "content.resourceLink": lazy(() => import("./scenes/content").then((m) => ({ default: m.ResourceLinkScene }))),
  "exam.window": lazy(() => import("./scenes/exam").then((m) => ({ default: m.WindowScene }))),
  "exam.attempts": lazy(() => import("./scenes/exam").then((m) => ({ default: m.AttemptsScene }))),
  "exam.timeLimit": lazy(() => import("./scenes/exam").then((m) => ({ default: m.TimeLimitScene }))),
  "exam.passing": lazy(() => import("./scenes/exam").then((m) => ({ default: m.PassingScene }))),
  "exam.shuffle": lazy(() => import("./scenes/exam-bank").then((m) => ({ default: m.ShuffleScene }))),
  "exam.pool": lazy(() => import("./scenes/exam-bank").then((m) => ({ default: m.PoolScene }))),
  "exam.results": lazy(() => import("./scenes/exam").then((m) => ({ default: m.ResultsScene }))),
  "exam.openQuestion": lazy(() => import("./scenes/exam-bank").then((m) => ({ default: m.OpenQuestionScene }))),
  "exam.ordering": lazy(() => import("./scenes/exam-bank").then((m) => ({ default: m.OrderingScene }))),
  "exam.imageDrag": lazy(() => import("./scenes/exam-image").then((m) => ({ default: m.ImageDragScene }))),
  "exam.imageClick": lazy(() => import("./scenes/exam-image").then((m) => ({ default: m.ImageClickScene }))),
  "exam.categorize": lazy(() => import("./scenes/exam-sort-fill").then((m) => ({ default: m.SortScene }))),
  "exam.cloze": lazy(() => import("./scenes/exam-sort-fill").then((m) => ({ default: m.FillScene }))),
  "assignment.late": lazy(() => import("./scenes/assignment").then((m) => ({ default: m.LateScene }))),
  "assignment.replace": lazy(() => import("./scenes/assignment").then((m) => ({ default: m.ReplaceScene }))),
  "assignment.fileTypes": lazy(() => import("./scenes/assignment").then((m) => ({ default: m.FileTypesScene }))),
  "groups.close": lazy(() => import("./scenes/people").then((m) => ({ default: m.GroupCloseScene }))),
  "groups.import": lazy(() => import("./scenes/people").then((m) => ({ default: m.ImportScene }))),
  "students.trash": lazy(() => import("./scenes/people").then((m) => ({ default: m.TrashScene }))),
  "renewals.actions": lazy(() => import("./scenes/people").then((m) => ({ default: m.RenewalsScene }))),
  "templates.fields": lazy(() => import("./scenes/certificates").then((m) => ({ default: m.TemplateFieldsScene }))),
  "admin.storage": lazy(() => import("./scenes/admin").then((m) => ({ default: m.StorageScene }))),
  "branding.cover": lazy(() => import("./scenes/admin").then((m) => ({ default: m.CoverPlacementScene }))),
};
