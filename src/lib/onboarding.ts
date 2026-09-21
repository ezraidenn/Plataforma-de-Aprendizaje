/** Primeros pasos del maestro (banda del Inicio). Puro: sin BD ni Next. */
export type OnboardingFacts = {
  hasCourse: boolean;
  hasLesson: boolean;
  hasStudent: boolean;
  hasPublishedWithEnrollment: boolean;
  hasTemplate: boolean;
  /** Curso con updated_at más reciente (destino de los pasos 2, 4 y 5) */
  latestCourseId: string | null;
};
export type OnboardingStepKey = "course" | "lesson" | "students" | "publish" | "template";
export type OnboardingStep = {
  key: OnboardingStepKey;
  /** Nombre corto (píldoras, lista) */
  title: string;
  /** Frase de ayuda (lista desplegada y banda) */
  help: string;
  /** Texto del botón */
  action: string;
  href: string;
  done: boolean;
};
export type Onboarding = { steps: OnboardingStep[]; next: OnboardingStep | null; done: number; total: number };

export function onboardingSteps(f: OnboardingFacts): Onboarding {
  const create = "/teach/dashboard?nuevo=1";
  // Cada destino llega con la acción concreta lista: diálogo abierto, menú
  // desplegado o el bloque señalado. Sin curso todavía, todo lleva a crearlo.
  const course = (sub: string) => (f.latestCourseId ? `/teach/courses/${f.latestCourseId}/${sub}` : create);
  const steps: OnboardingStep[] = [
    { key: "course", title: "Crea tu primer curso", help: "Un curso reúne carpetas y lecciones que tus estudiantes recorren a su ritmo o en orden.", action: "Crear curso", href: create, done: f.hasCourse },
    { key: "lesson", title: "Agrega una lección", help: "Documento, video, texto, examen o tarea: lo que el alumno va a estudiar.", action: "Agregar", href: course("content?agregar=1"), done: f.hasLesson },
    { key: "students", title: "Registra a tus estudiantes", help: "Uno por uno o importando un CSV; después los matriculas en el curso.", action: "Registrar", href: "/teach/students?nuevo=1", done: f.hasStudent },
    { key: "publish", title: "Matricúlalos y publica el curso", help: "Inscribe a tus estudiantes y publica: hasta entonces nadie lo ve.", action: "Matricular", href: course("students?matricular=1"), done: f.hasPublishedWithEnrollment },
    { key: "template", title: "Diseña o elige el diploma", help: "Asigna una plantilla de certificado al curso; se emite solo al aprobar.", action: "Elegir diploma", href: course("settings#diploma"), done: f.hasTemplate },
  ];
  const done = steps.filter((s) => s.done).length;
  return { steps, next: steps.find((s) => !s.done) ?? null, done, total: steps.length };
}
