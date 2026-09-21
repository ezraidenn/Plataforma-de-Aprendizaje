"use client";

import { lazy, type ComponentType, type LazyExoticComponent } from "react";

/**
 * Escenas animadas de la guía, por paso. Se descargan solo cuando el paso
 * entra en pantalla. Varias reutilizan una escena del «?» con valores fijos:
 * cuentan lo mismo y no vale la pena duplicarlas.
 */
export const GUIDE_SCENES: Record<string, LazyExoticComponent<ComponentType>> = {
  "student-curso-1": lazy(() =>
    import("@/components/help/scenes/course").then((m) => ({
      default: function GuideSequential() {
        return <m.SequentialScene value={{ enabled: true }} />;
      },
    }))
  ),
  "student-curso-2": lazy(() =>
    import("@/components/help/scenes/content").then((m) => ({
      default: function GuideDocSeconds() {
        return <m.DocSecondsScene value={{ seconds: 20 }} />;
      },
    }))
  ),
  "student-curso-3": lazy(() =>
    import("@/components/help/scenes/content").then((m) => ({
      default: function GuideTextSeconds() {
        return <m.TextSecondsScene value={{ seconds: 90 }} />;
      },
    }))
  ),
  "student-curso-4": lazy(() =>
    import("./video-watch").then((m) => ({ default: m.VideoWatchScene }))
  ),
  "student-examen-2": lazy(() =>
    import("./exam-run").then((m) => ({ default: m.ExamRunScene }))
  ),
  "student-examen-3": lazy(() =>
    import("@/components/help/scenes/exam").then((m) => ({
      default: function GuideAttempts() {
        return <m.AttemptsScene value={{ attempts: 3, policy: "best" }} />;
      },
    }))
  ),
  "student-tarea-2": lazy(() =>
    import("@/components/help/scenes/assignment").then((m) => ({
      default: function GuideLate() {
        return <m.LateScene value={{ hasDue: true, allowLate: true }} />;
      },
    }))
  ),
  "student-certificado-3": lazy(() =>
    import("@/components/help/scenes/course").then((m) => ({
      default: function GuideValidity() {
        return <m.ValidityScene value={{ mode: "months", months: 12 }} />;
      },
    }))
  ),
  "student-examen-1": lazy(() =>
    import("./exam-start").then((m) => ({ default: m.ExamStartScene }))
  ),
  "student-tarea-3": lazy(() =>
    import("./returned").then((m) => ({ default: m.ReturnedScene }))
  ),
  "teacher-curso-3": lazy(() =>
    import("@/components/help/scenes/course").then((m) => ({
      default: function GuideStatus() {
        return <m.StatusScene value={{ status: "published" }} />;
      },
    }))
  ),
  "teacher-contenido-9": lazy(() =>
    import("@/components/help/scenes/content").then((m) => ({
      default: function GuideRequired() {
        return <m.RequiredScene value={{ required: true }} />;
      },
    }))
  ),
  "teacher-reglas-1": lazy(() =>
    import("@/components/help/scenes/rules").then((m) => ({
      default: function GuideOperator() {
        return <m.OperatorScene value={{ op: "AND" }} />;
      },
    }))
  ),
  "teacher-grupos-2": lazy(() =>
    import("@/components/help/scenes/people").then((m) => ({ default: m.ImportScene }))
  ),
  "teacher-grupos-4": lazy(() =>
    import("@/components/help/scenes/people").then((m) => ({ default: m.TrashScene }))
  ),
  "teacher-vencimientos-3": lazy(() =>
    import("@/components/help/scenes/people").then((m) => ({ default: m.RenewalsScene }))
  ),
  "teacher-contenido-1": lazy(() =>
    import("./tree-edit").then((m) => ({ default: m.TreeEditScene }))
  ),
  "teacher-contenido-2": lazy(() =>
    import("./doc-convert").then((m) => ({ default: m.DocConvertScene }))
  ),
  "teacher-contenido-4": lazy(() =>
    import("./video-link").then((m) => ({ default: m.VideoLinkScene }))
  ),
  "teacher-reglas-2": lazy(() =>
    import("./rules-recheck").then((m) => ({ default: m.RulesRecheckScene }))
  ),
  "teacher-alumnos-3": lazy(() =>
    import("./csv-import").then((m) => ({ default: m.CsvImportScene }))
  ),
  "teacher-calificar-1": lazy(() =>
    import("./grading-queue").then((m) => ({ default: m.GradingQueueScene }))
  ),
  "teacher-calificar-2": lazy(() =>
    import("./open-grading").then((m) => ({ default: m.OpenGradingScene }))
  ),
  "teacher-certificados-2": lazy(() =>
    import("./template-drag").then((m) => ({ default: m.TemplateDragScene }))
  ),
  "admin-identidad-2": lazy(() =>
    import("@/components/help/scenes/admin").then((m) => ({
      default: function GuideCover() {
        return <m.CoverPlacementScene value={{ placement: "both" }} />;
      },
    }))
  ),
  "admin-operacion-3": lazy(() =>
    import("@/components/help/scenes/admin").then((m) => ({ default: m.StorageScene }))
  ),
  "admin-usuarios-1": lazy(() =>
    import("./new-user").then((m) => ({ default: m.NewUserScene }))
  ),
  "admin-usuarios-3": lazy(() =>
    import("./account-toggle").then((m) => ({ default: m.AccountToggleScene }))
  ),
  "admin-usuarios-4": lazy(() =>
    import("./identity-permission").then((m) => ({ default: m.IdentityPermissionScene }))
  ),
  "admin-cursos-1": lazy(() =>
    import("./reassign-owner").then((m) => ({ default: m.ReassignOwnerScene }))
  ),
  "admin-operacion-1": lazy(() =>
    import("./jobs-queue").then((m) => ({ default: m.JobsQueueScene }))
  ),
  "admin-operacion-4": lazy(() =>
    import("./cert-ondemand").then((m) => ({ default: m.CertOnDemandScene }))
  ),
};
