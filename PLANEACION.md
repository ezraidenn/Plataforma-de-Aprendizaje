# Plataforma de Aprendizaje — Plan Maestro

> **ESTADO: las 5 fases (0–4) están COMPLETADAS y verificadas** (2026-07-27).
> Suites de prueba: `scripts/smoke-f1|f2|f3|f4.ts` (dominio) y `scripts/smoke-http.cjs` (rutas).
> Despliegue en el servidor de la empresa: ver `INSTALACION.md`. Gestor de paquetes: **pnpm**.

> LMS local para capacitación corporativa. Servidor: una PC Windows en la LAN de la empresa, sin internet garantizado. Acceso vía navegador en `http://<IP-servidor>:3000`.
>
> **Escala confirmada**: 1,000–5,000 usuarios registrados; ~100 concurrentes máximo. LibreOffice puede instalarse en el servidor. Notificaciones **solo in-app** (sin correo).
>
> Documento generado el 2026-07-24 a partir de: (a) investigación de plataformas líderes (Moodle, LearnDash, TalentLMS, iSpring, Absorb, Docebo) y estándares (SCORM/xAPI/cmi5), y (b) diseño de arquitectura técnica.

---

## 1. Visión del producto

Plataforma de capacitación interna donde:

- **Maestros** registran estudiantes, crean cursos con estructura de carpetas ordenables (drag & drop) que contienen lecciones: **PPT, PDF, video, lectura de texto, examen y tarea entregable**.
- **Estudiantes** consumen el contenido en orden forzado (configurable): no pueden abrir el elemento N+1 sin completar el N, y ningún contenido se marca completo sin consumirse al 100% real (todas las páginas vistas / todos los segundos reproducidos).
- Al cumplir el **criterio de aprobación configurable del curso** (ej. promedio de exámenes ≥ 80% Y visualización = 100%): se notifica al maestro, se actualizan los listados de progreso y se emite automáticamente un **certificado PDF descargable** con plantilla del maestro, folio único y QR de verificación.

### Principios de diseño (decisiones ya tomadas)

1. **Completado ≠ Aprobado** (insight de cmi5/iSpring): son dos dimensiones separadas. "Completado" = consumió el contenido; "Aprobado" = cumplió la nota. Un ítem sin nota (PDF) solo tiene completado; un examen tiene ambos.
2. **El cliente reporta, el servidor acredita**: todo el tracking se valida server-side con el reloj del servidor. El frontend solo mejora la UX (bloquear seek, deshabilitar botones); la regla dura vive en el backend.
3. **Anti-trampa sensato, no vigilancia**: pool de preguntas aleatorias + tiempo límite + intentos limitados + tracking real de consumo. NO webcam, NO proctoring IA, NO lockdown browser.
4. **Modelo de datos propio, no SCORM**: implementar un runtime SCORM/xAPI son semanas de trabajo y solo sirve para importar cursos de terceros. Los maestros suben PPT/PDF/video directo → modelo propio más simple y más rico. El ítem es polimórfico: si algún día se necesita SCORM, se agrega como un tipo más.
5. **Mostrar lo bloqueado, no ocultarlo**: los ítems con candado se ven en el árbol con tooltip "Completa X primero" (patrón universal de la industria; motiva más que ocultar).

---

## 2. Stack tecnológico

| Capa | Elección | Por qué |
|---|---|---|
| Framework | **Next.js 15 (App Router) + TypeScript** | Un solo proceso sirve todo en LAN; Server Actions eliminan backend separado; stack que ya dominas |
| DB | **SQLite (WAL mode)** | Cero administración; backup = copiar un archivo; sobrado para cientos de usuarios en LAN |
| ORM | **Drizzle + better-sqlite3** | Driver más rápido para SQLite en Node; sin binarios de motor (Prisma en Windows offline da problemas); migraciones SQL planas |
| Auth | **Sesiones propias** (tabla `sessions` + cookie httpOnly + argon2id) | 100% offline, sin proveedor externo |
| Archivos | **Filesystem local** `./storage/` (NUNCA en `public/`) servido por `/api/files/[id]` con auth + HTTP Range | Control de acceso por matrícula + streaming de video |
| PPT → visualizable | **LibreOffice headless** (`soffice --headless --convert-to pdf`) | Única vía robusta y offline para PPT/PPTX. Todo documento se normaliza a PDF → un solo visor, un solo modelo de tracking |
| Visor documentos | **pdf.js** embebido en componente propio (modo página por página, no scroll) | Control total de navegación para tracking y bloqueo |
| Video | **Solo enlaces** (YouTube/Vimeo embed vía IFrame Player API) — sin subida ni procesamiento de video | El tráfico de video va al servicio externo, no al servidor. La API del iframe permite leer posición/velocidad para el tracking. Requiere internet en los equipos cliente solo para ítems de video. Uso esperado: marginal (los videos normalmente se proyectan en persona) |
| Certificados | **pdf-lib + qrcode** | Estampa campos sobre el fondo subido por el maestro; QR → `/verify/[folio]` |
| Jobs | **Tabla `jobs` en SQLite + worker en el mismo proceso** (arranca en `instrumentation.ts`) | Conversiones tardan; sin Redis ni colas externas; sobrevive reinicios |
| UI | Tailwind + shadcn/ui + **dnd-kit** (árbol ordenable) + TanStack Query | dnd-kit es el estándar para sortable trees en React |
| Despliegue | `next build && next start` como **servicio de Windows (NSSM)** | Arranque automático con la PC; reinicio ante crash; script diario de backup (`data.db` + `storage/`) |
| Gestor de paquetes | **pnpm** (lockfile `pnpm-lock.yaml`) | Decisión por seguridad de cadena de suministro: pnpm bloquea scripts de instalación por defecto (solo los autorizados en `pnpm.onlyBuiltDependencies`); usar `pnpm install/run`, NO npm |

**Descartado explícitamente**: Postgres (administración innecesaria), Electron (es multiusuario en red), servicios cloud (sin internet), runtime SCORM, proctoring.

---

## 3. Modelo de datos

Convenciones: PK `id` texto (nanoid), `created_at`/`updated_at` en todas.

### 3.1 Identidad
- **`users`**: email único, password_hash, full_name, `role` (admin | teacher | student), active, `created_by` (el maestro que dio de alta al estudiante).
- **`sessions`**: token hasheado, user_id, expires_at, ip, user_agent.

### 3.2 Cursos y árbol de contenido (núcleo)
- **`courses`**: title, description, cover, `owner_id` (maestro), `status` (draft | published | archived), `enforce_sequence` (flag "progresión lineal vs. libre", patrón LearnDash), `completion_rules` (JSON, ver §5), `certificate_template_id` (nullable).
- **`enrollments`**: course_id + student_id únicos, enrolled_by, `status` (active | completed | dropped), completed_at.
- **`course_items`** — árbol en una sola tabla (adjacency list): `parent_id` (nullable = raíz), `position` (orden entre hermanos; drag & drop = actualizar parent + renumerar hermanos en transacción), `kind` (folder | document | video | text | exam | assignment), title, `sequence_mode` (inherit | required | free — override por ítem), `required_for_completion` (permite ítems opcionales), visible.
  - Regla de sanidad: anidación de carpetas máx. 1–2 niveles (la anidación infinita de Moodle es fuente de confusión).

### 3.3 Detalle por tipo (Class Table Inheritance, 1:1 con course_items)
- **`item_documents`** (PPT y PDF unificados): source_file (original), render_file (PDF resultante), source_type, `page_count`, `min_seconds_per_page` (default 3), processing_status.
- **`item_videos`** (enlace externo, sin archivo): `url`, `provider` (youtube | vimeo | other), `video_id` extraído, `duration_seconds` (obtenida de la API del player al primer load y guardada; editable por el maestro como respaldo), `allow_speed_up`.
- **`item_texts`**: content_md, min_read_seconds.
- **`item_assignments`**: instructions_md, due_at, max_score, allowed_file_types, allow_resubmission.
- **`exams`**: instructions, `opens_at`/`closes_at` (ambos null = siempre abierto), `max_attempts` (null = ilimitado), `attempt_score_policy` (best | last | average; default **best**), `time_limit_minutes` (autoenvío al agotarse), pass_score, `shuffle_questions`, `show_results_mode` (immediately | after_close | manual).

### 3.4 Exámenes
- **`questions`**: exam_item_id, position, `type`, prompt_md, points, imagen opcional.
  - Tipos v1: `single_choice`, `multiple_choice` (puntaje parcial opcional), `true_false`, `short_text` (respuesta exacta con variantes aceptadas), `matching` (relacionar columnas), `open_text` (calificación manual).
  - Fase posterior: **banco de preguntas por categoría + pool aleatorio** (el examen toma N preguntas al azar, distinto por alumno — reduce copiado ~65-70% según datos de la industria).
- **`question_options`**: question_id, position, text_md, is_correct.
- **`exam_attempts`**: attempt_number, started_at, submitted_at, auto_score, manual_score, final_score, max_score_snapshot, `status` (in_progress | submitted | graded), graded_by/at. Único por (exam, student, attempt_number).
- **`attempt_answers`**: selected_option_ids (JSON) o answer_text, auto_points, manual_points, feedback_md.
- Flujo: choice/TF/short se autocalifican al enviar; si hay open_text → status `submitted` y entra a la **cola de calificación** del maestro; al calificar todo → `graded` y `final_score` alimenta el motor de reglas.

### 3.5 Tracking granular
- **`item_progress`** (resumen por estudiante × ítem): `status` (locked | available | in_progress | completed), `percent`, completed_at, last_activity_at, `total_seconds` (tiempo invertido — los reportes corporativos siempre lo piden).
- **`document_progress`**: `pages_viewed` como **bitmap BLOB** (bit N = página N vista ≥ tiempo mínimo; 100 páginas = 13 bytes), `current_page` (para reanudar), last_heartbeat_at.
- **`video_progress`**: `watched_intervals` (JSON de intervalos fusionados `[[0,94],[120,300]]`), `max_position` (frontera del seek), last_position (para reanudar). Cobertura ≥ 97% ⇒ 100% (evita el problema de los créditos finales).
- **`assignment_submissions`**: file, comment, score, feedback, status (submitted | graded | returned).

### 3.6 Certificados, notificaciones, soporte
- **`certificate_templates`**: owner (maestro), name, `background_file` (PDF/imagen carta o A4), `fields` JSON posicionables (`student_name`, `course_title`, `date`, `score`, `folio`, `qr`, `custom_text` — con x, y, fuente, tamaño, color, align), page_size, orientation. Editor visual con preview (probar con nombres largos — falla clásica).
- **`certificates`**: `folio` único legible (`CERT-2026-000123-K7QX` = secuencia + sufijo aleatorio anti-adivinación), enrollment, `template_snapshot` (editar la plantilla NO altera certificados ya emitidos), pdf_file, verification_hash, `revoked` + reason. Página pública LAN `/verify/[folio]` (destino del QR).
- **`notifications`**: user_id destinatario, `type` (course_completed | assignment_submitted | exam_needs_grading | certificate_issued | deadline_reminder), payload JSON, read_at.
  - `deadline_reminder` (X días antes del cierre de un examen) es la notificación más valorada en corporativo.
- **`files`**: original_name, stored_path, mime, size, sha256, uploaded_by, kind.
- **`jobs`**: type (convert_ppt | process_pdf | process_video | generate_certificate), payload, status, attempts, error_message, run_after.
- **`audit_log`**: user, action, entity, detail — barato y útil para disputas ("el sistema me borró el intento").

---

## 4. Tracking anti-salto (diseño detallado)

**Heartbeat**: POST cada 10 s mientras el visor está activo y la pestaña visible (se pausa con `visibilitychange`), y en pause/ended/beforeunload: `{ itemId, kind, page?, position?, playbackRate? }`.

**Documentos (PPT/PDF/texto)**:
1. Una página se acredita en el bitmap solo si el heartbeat anterior ya reportaba esa página y pasaron ≥ `min_seconds_per_page` de **reloj del servidor**.
2. Presupuesto de tiempo: nunca se acreditan más páginas que `tiempo_real_en_el_ítem / min_seconds_per_page` → anula scripts que manden 50 heartbeats seguidos.
3. Navegar hacia atrás o adelante para *leer* es libre; solo el *crédito* exige permanencia. En modo secuencial, el botón "siguiente" se habilita tras el mínimo.
4. `percent = popcount(bitmap) / page_count`. Guarda última página para "continuar donde te quedaste".

**Video (embeds de YouTube/Vimeo)**:
1. El player embebido (IFrame Player API) se sondea cada segundo: `getCurrentTime()` + `getPlaybackRate()`. Los heartbeats al servidor siguen el mismo esquema: intervalo `[last_position, position]` se acredita solo si `Δposición ≤ Δt_servidor × rate_max + 2s`. Seek adelante: se registra la posición pero NO se acredita el salto.
2. Cliente detecta saltos más allá de `max_position` y hace `seekTo(maxWatched)`. Retroceder para repasar es libre y re-ver no duplica crédito (merge de intervalos).
3. `percent` = cobertura de intervalos / `duration_seconds` guardada en el ítem.
4. **Limitación asumida**: el video vive en YouTube — el alumno podría verlo directo en youtube.com sin que la plataforma lo registre, y el bloqueo de seek en un iframe es best-effort. Aceptable porque el uso de video es marginal (normalmente se proyecta en persona); el tracking estricto de verdad recae en documentos y exámenes.

**Gating N+1**: `canAccess(enrollment, item)` calcula el orden lineal del árbol (DFS por position; una carpeta está completa cuando sus hijos requeridos lo están) y verifica que todo ítem anterior con secuencia efectiva `required` esté completado. Se valida al renderizar la página **y** en cada endpoint (`/api/files`, heartbeat, iniciar intento) → la URL directa no salta el candado.

**Lo que NO se hace**: detección de mirada, bloqueo de multitarea, fingerprinting. El objetivo es impedir el "clic y completar", no vigilancia.

---

## 5. Motor de reglas de aprobación

`courses.completion_rules` = árbol JSON de condiciones, editado con **constructor visual** (no texto libre). Default: `AND` plano.

```json
{
  "op": "AND",
  "conditions": [
    { "type": "exam_average", "min_percent": 80, "scope": "all" },
    { "type": "viewing_completion", "min_percent": 100 },
    { "type": "assignments_graded", "min_percent": 70 }
  ]
}
```

Tipos de condición (cada uno una función pura `(ctx) => { passed, value, detail }`):
- `exam_average` — promedio de exámenes (todos o lista específica), según `attempt_score_policy` de cada uno. No pasa si falta algún intento calificado.
- `exam_specific` — un examen concreto ≥ X%.
- `viewing_completion` — % de ítems document/video/text requeridos completados.
- `all_items_completed` — todo lo requerido completado.
- `assignments_graded` — promedio de tareas ≥ X.
- `manual_approval` — aprobación manual del maestro como condición extra (útil en corporativo).
- Nodos `AND`/`OR` anidables.

**Evaluación por eventos, no por cron**: se dispara cuando un ítem pasa a completed, se publica un final_score, o se califica una tarea. Si pasa (idempotente, en transacción): `enrollment.completed_at`, job `generate_certificate`, notificaciones a maestro y alumno. **Nunca des-aprueba automáticamente**: una recalificación a la baja notifica al maestro para decisión manual (posible revocación de certificado).

El desglose por condición se guarda y se muestra al alumno: *"Te falta: examen 2 (65% < 80%)"*.

---

## 6. Pipeline de subida de contenido

**Subida**: `POST /api/uploads` con streaming directo a `storage/tmp/` (nunca buffer completo en memoria — hay PPTs pesados). Al terminar: sha256 → mover a `storage/{kind}/{yyyy}/{fileId}.ext` → fila en `files` → ítem `processing_status: pending` → job encolado. UI del maestro muestra estado con polling.

**Worker** (en serie para conversiones — LibreOffice y ffmpeg son CPU-bound):
- **PPT/PPTX**: `soffice --headless --convert-to pdf` (timeout 3 min) → sigue el flujo de PDF. El original se conserva re-descargable.
- **PDF**: page_count con pdf-lib + thumbnail de página 1 → `ready`. (No se rasterizan todas las páginas; el visor usa pdf.js sobre el PDF.)
- **Video**: no hay procesamiento — el maestro pega el enlace, se valida/extrae el `video_id` y el thumbnail se toma del servicio (`img.youtube.com`). Sin job.
- **Errores**: visibles al maestro con mensaje y botón de reintento.

---

## 7. Estructura de la app (`src/app`)

```
src/
├── app/
│   ├── (auth)/login/
│   ├── (student)/                    # guard role=student
│   │   ├── dashboard/                # "Continuar donde te quedaste" + mis cursos con % + certificados
│   │   └── courses/[courseId]/
│   │       ├── page.tsx              # índice del curso (árbol con checkmarks y candados)
│   │       └── items/[itemId]/       # despacha: DocumentViewer | VideoPlayer | TextReader | ExamRunner | AssignmentBox
│   ├── (teacher)/teach/              # guard role=teacher|admin
│   │   ├── dashboard/
│   │   ├── courses/[courseId]/
│   │   │   ├── content/              # editor del árbol (dnd-kit) + CRUD ítems
│   │   │   ├── items/[itemId]/edit/  # editor por tipo (examen: CRUD preguntas)
│   │   │   ├── rules/                # constructor visual de reglas de aprobación
│   │   │   ├── students/             # matrícula + progreso detallado por alumno
│   │   │   └── grading/              # cola: open_text y tareas por calificar
│   │   ├── students/                 # CRUD estudiantes
│   │   ├── templates/                # plantillas de certificado + editor visual
│   │   └── reports/                  # matriz alumnos × ítems, export CSV
│   ├── (admin)/admin/                # users / courses / settings
│   ├── verify/[folio]/               # pública en LAN: validación de certificado (QR)
│   └── api/
│       ├── files/[fileId]/           # GET con auth + HTTP Range
│       ├── progress/heartbeat/       # POST tracking
│       └── uploads/                  # POST multipart streaming
├── middleware.ts                     # sesión + gate por rol
├── server/                           # dominio puro (sin React)
│   ├── db/ (schema.ts, migrations/)
│   ├── auth/
│   ├── services/ (courses, tree, progress, exams, grading, rules-engine, certificates, notifications, media/)
│   └── jobs/ (worker.ts, handlers/)
├── components/ (viewers/, tree-editor/, exam/, template-editor/, ui/)
└── instrumentation.ts                # arranca el job worker
```

CRUD vía Server Actions; route handlers solo para streaming y alta frecuencia.

---

## 8. UX de dashboards (patrones probados de la industria)

**Estudiante**:
- "**Continuar donde te quedaste**" como elemento principal (botón directo al último ítem en progreso).
- Cursos con anillo de %, fechas límite próximas destacadas, sección de certificados.
- Dentro del curso: sidebar tipo LearnDash Focus Mode — árbol con checkmarks verdes, ítem actual resaltado, futuros con candado + tooltip.

**Maestro**:
- **Matriz alumnos × cursos con semáforo** (no iniciado / en progreso / completado / vencido) — "quién va atrasado" de un vistazo.
- Drill-down por alumno: por ítem, % visto, intentos, puntajes, tiempo invertido.
- Cola de calificación pendiente. Export CSV/Excel (imprescindible en corporativo).

**Gamificación — ligera**: badges por hitos (primer curso, >90%), barra de progreso prominente. Leaderboards solo por departamento si acaso, nunca global. NO economía de puntos.

---

## 9. Fases de implementación (~55 pts; 1 pt ≈ media jornada)

**Fase 0 — Cimientos (5 pts)**: scaffolding Next + Drizzle + migraciones, auth con sesiones y roles, middleware, layout base shadcn, `files` + upload streaming + `/api/files` con Range.

**Fase 1 — MVP de cursos (12 pts)**: CRUD cursos y estudiantes, árbol con drag & drop, lecciones `text` y `pdf` (pdf.js), matrícula, secuenciación básica, tracking de páginas (heartbeat + bitmap), dashboards mínimos. → **Al final, la plataforma ya es usable para cursos de lectura.**

**Fase 2 — Video y exámenes (11 pts)**: worker de jobs, ítem de video por enlace (embed + tracking de intervalos vía IFrame API), CRUD exámenes/preguntas, ExamRunner con intentos, fechas y autocalificación, motor de reglas v1 (AND plano).

**Fase 3 — Certificados y calificación manual (12 pts)**: pipeline PPT (LibreOffice), cola de grading (open_text + tareas), plantillas de certificado con editor visual + preview, emisión con folio + QR + `/verify`, notificaciones in-app.

**Fase 4 — Reportes y endurecimiento (12 pts)**: matriz ítem × alumno, export CSV, panel admin, `sequence_mode` por ítem, condiciones OR/anidadas, banco de preguntas + pool aleatorio, audit log, backup, servicio Windows (NSSM), doc de instalación (Node, LibreOffice, firewall).

Dependencias: F0 → todo; worker (F2) antes que PPT (F3); motor de reglas antes que certificados.

**Fase 6 — Ajustes, contenidos y guía (hecha 2026-08-21)**: ruta `/ajustes` para los 3 roles (contraseña con cierre de otras sesiones; nombre solo maestro/admin; identidad de la empresa para admin y maestros con `users.can_edit_branding`); portada opcional (6 presets SVG en `src/lib/cover-presets.ts` o foto) para login y/o panel con miniatura de previsualización; tipos de contenido **Recurso descargable** (`item_resource_files`) y **Enlace externo** (`item_links`) que se completan al descargar/abrir; tarea estilo Teams (adjuntos del maestro en `assignment_attachments`, respuesta con texto HTML + varios archivos en `submission_files`); editor TipTap que guarda **HTML saneado** (`src/lib/rich-html.ts`, allowlist de estilos; el pegado conserva colores/tamaños/tablas/alineación/sangrías y descarta fuentes; imágenes pegadas se suben como `editor_image`); guía de uso por rol en `/guia` (datos en `src/content/guide/*.ts`) con descarga HTML autocontenido (`/api/guide?role=`). Migración 0005.

**Fase 7 — Almacenamiento en NAS (hecha 2026-09-09)**: carpeta de archivos configurable desde Admin → Configuración (`app_settings.storage_path` → `STORAGE_PATH` → `./storage`), con validación de acceso y escritura real antes de aceptarla; estructura legible en disco `Cursos\<Curso>\<NN Módulo>\<NN Lección>`, `Entregas\<Curso>\<Tarea>\<Alumno> — <fecha>` y `_Sistema\` (`src/server/services/storage-paths.ts` + `storage-layout.ts`), con saneado de nombres para Windows/SMB; renombrar un curso o lección mueve las carpetas en segundo plano (job `relocate_files`) y borrar contenido retira los archivos huérfanos (`cleanup_files`); los certificados dejan de guardarse como PDF y se generan al descargar desde `template_snapshot` (~22 ms) en `/api/certificates/<folio>`; herramientas `pnpm storage plan|apply|check|where|move`. La base de datos permanece siempre en disco local (SQLite WAL no es fiable sobre SMB). Además, `APP_URL` pasa a ser opcional: sin ella la plataforma detecta sola la IPv4 del equipo (socket UDP a la ruta por defecto, descartando adaptadores virtuales) y esa es la dirección que llevan los QR de los certificados; se muestra en Admin → Configuración → Dirección en la red.

**Fase 8 — Vigencia, recertificación, grupos y papelera (hecha 2026-09-10)**: **Vigencia por curso** (`courses.validity_mode`: vitalicio | año calendario | N meses desde que se aprueba; cálculo en `src/lib/validity.ts`); cada certificado congela su `expires_at` al emitirse (cambiar la política no toca los ya emitidos), la plantilla admite el campo «Vigencia» y `/verify` distingue «vigente hasta…», «vencido — fue válido del … al …» y permanente. **Ciclos de recertificación**: `enrollments.cycle` (único por curso × alumno × ciclo); intentos de examen y entregas se atan a su matrícula (`enrollment_id`), así que el ciclo nuevo empieza en cero sin tocar el historial; las vistas muestran solo el ciclo más reciente (`latestCycleOnly` en `enrollment-scope.ts`). **Panel de vencimientos** `/teach/renewals` (por vencer ≤ 30 días / vencidos): sin avisos ni reinscripción automática — el maestro elige a quién reinscribir (abre el ciclo n+1, en su grupo o en otro) o descarta con motivo (baja, reemplazado por otro curso/NOM, no aplica, otro); todo queda en `certificates.renewal_*` y en la auditoría. **Grupos con nombre, propios de cada curso** (`cohorts.course_id`, `/teach/groups`; migración 0007 repartió los grupos existentes por curso): los filtros de un curso solo muestran sus grupos; la matrícula elige o crea un grupo del curso o **trae un grupo de otro curso** (`importCohortIntoCourse`: inscribe a sus miembros en un grupo con el mismo nombre; el original no cambia y los ya inscritos se quedan igual); cerrar un grupo lo saca de las vistas diarias (lista del curso, reportes, estadísticas) sin borrar nada, y el filtro `?grupo=` (abiertos por defecto | all | none | id) permite verlo de nuevo. **Papelera de bajas**: dar de baja guarda `dropped_at/by/from` y no toca progreso, calificaciones ni certificado; restaurar (o volver a inscribir) devuelve al alumno exactamente con el estatus que tenía. Además se corrigió el consecutivo del folio (antes `COUNT(*)+1`, que repetía números si se borraba un certificado; ahora el mayor emitido + 1). Migración 0006 con relleno de `enrollment_id`. Datos demo: `scripts/seed-demo-cycles.ts`. Prueba: `scripts/smoke-f6.ts`.

**Contador de tiempo y login (hecho 2026-09-10)**: cada lección con tiempo mínimo muestra arriba a la derecha un contador (`src/components/student/study-timer.tsx`): lecturas («Faltan 1:30» del mínimo de lectura; el latido devuelve `creditedSeconds` para corregirlo con el reloj del servidor), documentos (segundos de la página actual + estimado del documento) y videos (lo que falta por ver, contra la duración guardada en el servidor; «En pausa» si no se reproduce). Es informativo: quien acredita sigue siendo el servidor. En el login, los textos sobre la foto de portada llevan relieve negro (`.text-halo`) y un degradado en la columna del texto; el carrusel de cursos pasó de vidrio translúcido a tarjeta sólida con sombra, más grande, con flechas discretas a los lados y puntos centrados.

**Notificaciones y mantenimiento de la base (hecho 2026-09-10)**: la campana permite borrar una notificación o todas (con confirmación), al estilo Facebook; el clic en una notificación espera a que el servidor guarde el «leído» antes de navegar. Las pruebas automáticas (`scripts/lib/smoke-cleanup.ts`) borran al terminar las notificaciones que generan sobre sus cursos de prueba, porque usan las cuentas demo reales (eso hacía creer que las leídas «volvían»). Se descubrió que drizzle-kit omite `ON DELETE` en `ALTER TABLE ADD … REFERENCES`: la 0006 se corrigió y la base se reconstruyó desde cero con `pnpm db:rebuild` (semilla SQL + todas las migraciones + recarga verificada); `pnpm db:check` compara las claves foráneas de la base con `schema.ts` y debe correrse tras cada migración nueva.

**Ayuda visual con animaciones (hecha 2026-09-10)**: Junto a 34 ajustes hay un «?» (`src/components/help/help-tip.tsx`) que abre una escena animada causa → efecto hecha con piezas que copian la interfaz real (`src/components/help/mini/*`) y el valor actual del formulario, aunque no esté guardado. Cada escena es una historia pura `(fase, valor) → estado` (`scenes/*.story.ts`, probada en `pnpm smoke:help`) más su vista; se descargan solo al abrir el «?» (`registry.ts`) y con «reducir movimiento» muestran el cuadro final. Textos por área en `topics/`; catálogo en `/teach/ayuda` (menú Cuenta) armado con `catalog-config.ts`. Además, el editor de reglas ya permite **combinar condiciones con Y u O** (antes solo guardaba Y aunque el motor evaluaba O; prueba `pnpm smoke:rules`) y los tipos de archivo permitidos de las tareas se interpretan en un solo lugar (`src/lib/file-types.ts`). Revisión visual: `pnpm help:shots` (fotos de cada escena en dos instantes y en su cuadro final) y `pnpm help:tips` (abre cada «?» en 16 pantallas reales con ratón, clic, teclado y a 390 px).

**Publicar resultados de exámenes (hecha 2026-09-11)**: Una regla única (`src/lib/exam-results.ts`) decide cuándo ve el alumno su calificación: «Al enviar»; «Al cerrar el examen», o antes si el maestro publica; y «Cuando yo decida», al pulsar «Publicar resultados» en los ajustes del examen, con opción de ocultar. Antes, «Cuando yo decida» no tenía cómo publicar y «Al cerrar» ya mostraba el % en «Intentos anteriores». Mientras están ocultos no viaja ningún % al alumno: «Intentos anteriores» y la página del curso dicen «resultados pendientes», y calificar preguntas abiertas no avisa. Al volverse visibles, el alumno recibe un aviso en la campana, una sola vez por examen; el worker revisa cada 5 min los exámenes que cierran. Publicar y ocultar quedan en la auditoría. Migración 0008 (`exams.results_published_at`, `results_notified_at`). Prueba: `pnpm smoke:results`. También se corrigió el doble punto «p.m..» en las fechas del examen.

**Guías animadas (hecha 2026-09-14)**: Los 32 pasos de las guías donde el movimiento explica mejor que una foto (10 del alumno, 14 del maestro y 8 del administrador) (tiempo mínimo de lectura, tramos de video, candado secuencial, intentos, entrega devuelta, vigencia; del lado del maestro el árbol, la conversión de PPT, las reglas, el CSV, la cola de calificar y los campos del diploma; y del lado del administrador la contraseña temporal, desactivar una cuenta, reasignar un curso, la cola de trabajos y los certificados que se arman al descargarlos) llevan una escena animada arriba del texto; la captura real queda en el plegable «Ver la pantalla real». Cada paso declara su escena en `GuideStep.scene` y `src/components/guide/scenes/registry.tsx` la carga solo cuando hace falta; `guide-scene.tsx` la monta al entrar en pantalla y después solo **pausa su reloj** mientras no se ve (así corre solo a la vista, sin volver a descargarse ni reiniciarse al regresar; con «reducir movimiento» se ve el cuadro final). La pausa viaja por el contexto `SceneClockPaused` de `use-scene-clock.ts`, que el «?» no provee. 14 de las 32 reutilizan una escena del «?» con valores fijos; las 18 nuevas viven en `src/components/guide/scenes/*.story.ts` (historia pura) más su vista. La guía descargable no cambia: texto y captura. Pruebas: `pnpm smoke:guide` (historias y registro) y `pnpm guide:scenes` (fotos de cada escena en dos instantes y en su cuadro final).

**Tipo de pregunta «Ordenar pasos» (hecha 2026-09-21)**: El maestro escribe de 3 a 10 pasos en el orden correcto; el alumno los ve revueltos (nunca en el orden correcto) y los acomoda con flechas o arrastrándolos (dnd-kit, también con teclado). Como en «relacionar», al navegador solo viajan tokens opacos por intento (`orderingToken`), así el orden correcto no se filtra. Se califica por **pares consecutivos**: con n pasos hay n−1 pares y cuenta cada paso que quedó justo después del que le toca, de modo que un paso fuera de lugar solo quita lo que rompe. La matemática es pura y vive en `src/lib/ordering.ts`. CSV: tipo `ordenar` y columna nueva `pasos` (opcional para los demás tipos). Nuevo «?» `exam.ordering` (35 escenas en el catálogo). Prueba: `pnpm smoke:ordering`.

**Preguntas sobre imagen: arrastrar y señalar (hecha 2026-09-24)**: Dos tipos nuevos sobre una foto (PNG, JPG, WEBP o GIF, hasta 5 MB). En **«Arrastrar a la imagen»** el maestro sube la foto, agrega íconos (PNG) o etiquetas de texto, los pone en su lugar sobre la foto (un mismo elemento puede ir en varios lugares) y deja sin lugar los que quiera como **distractores**; elige el tamaño de los íconos (chico, mediano o grande; luego se reemplazó por un tamaño por elemento, ver «Íconos reales y editor tipo lienzo»). En **«Señalar en la imagen»** marca los puntos correctos y elige la **precisión** (estricta, normal o amplia), que decide el radio del círculo de acierto (3, 5 u 8 % del ancho de la foto). El alumno ve en la foto **lugares idénticos**: en reposo todos son el mismo círculo punteado y, al tomar una ficha, todos los libres toman su forma y su tamaño, así ninguno delata la respuesta; puede arrastrar, tocar la ficha y luego el lugar, o usar el teclado (fichas y lugares son botones; en señalar, una mira que se mueve con las flechas). En señalar pone marcas numeradas que se quitan tocándolas. Seguridad: los lugares llegan revueltos y cada lugar y cada ficha viajan como tokens opacos por intento (`imageZoneToken`, `imageItemToken`); los puntos correctos de señalar nunca salen del servidor (el alumno solo sabe cuántas marcas poner). Calificación parcial: cada lugar bien puesto o cada punto acertado vale su parte; los distractores puestos y los lugares vacíos cuentan cero; cada marca acredita un solo punto (emparejamiento máximo) y el círculo se mide corregido por la proporción de la foto, para que sea círculo y no óvalo. La revisión muestra miniaturas de la respuesta y de la solución (verde lo acertado, rojo punteado lo que faltó). Copiar el examen (al mismo curso o a otro) comparte la foto y los íconos: son imágenes de la plataforma y no se duplican. No caben en el CSV/Excel: exportar las omite y lo dice, e importar con «reemplazar» las conserva en su lugar. La vista previa del editor y «Ver como alumno» las muestran igual que al alumno. Sin migración: la foto va en `questions.image_file_id` y el resto en `config`. Archivos clave: `src/lib/image-questions.ts` (matemática pura), `src/lib/image-boards.ts` (tableros de revisión y vista previa), componentes en `src/components/exam/` (tablero y revisión) y `src/components/student/` (lo que responde el alumno), editor en `src/components/teach/exam/`. Nuevos «?» `exam.imageDrag` y `exam.imageClick` junto al tipo en el editor (37 escenas en el catálogo); las guías del maestro y del alumno los mencionan. Prueba: `pnpm smoke:image`.

**Íconos reales y editor tipo lienzo (hecha 2026-09-24)**: En «Arrastrar a la imagen» los íconos se ven **puros** (solo el PNG, sin tarjeta, con una sombra suave que sigue su silueta) en la foto, el banco, el fantasma, la revisión, la vista previa, el editor y la ayuda. Al tomar una ficha, **todos los lugares libres toman la silueta real del PNG** (máscara CSS con contorno y latido; un círculo se ve círculo y una cruz, cruz) con el tamaño y el giro de esa ficha, así que ninguno delata la respuesta; en reposo siguen siendo el mismo círculo punteado, y en la revisión el contorno verde o rojo sigue la silueta. Al subir un ícono, el navegador **recorta sus márgenes transparentes** (y lo reduce a 800 px si es más grande); los íconos viejos tienen «Quitar margen», que los recorta y reemplaza conservando tamaño, giro y lugares. El **tamaño es de cada elemento** y relativo a la foto (ícono: su **lado mayor** como fracción del ancho; etiqueta: el tamaño de letra), igual que el giro; todas las copias y lugares de un elemento miden y giran igual, y el alumno ve el acomodo del maestro en cualquier pantalla (con mínimos legibles en celular). Desaparece el selector global chico/mediano/grande (`iconSize` solo se lee en preguntas viejas). El editor es un **lienzo**: seleccionar con clic, Mayús+clic o recuadro (Ctrl+A todos, Esc ninguno), mover en grupo con el ratón o las flechas, **estirar** desde las esquinas y **girar** con la bolita (Mayús: de 15° en 15°) o con el panel «Seleccionado», **guías rojas e imán** (bordes y centros de otros lugares y de la foto; Alt lo suelta), **reglas** y **cuadrícula** (recordadas en el navegador), **alinear** y **repartir** (mostrando las distancias), **duplicar** (Ctrl+D), **deshacer y rehacer** hasta 100 pasos (Ctrl+Z, Ctrl+Mayús+Z o Ctrl+Y; un arrastre entero es un paso) y **zoom** del 50 al 400 % (botones, Ctrl+rueda sobre el cursor, Espacio+arrastrar para desplazarse, «Ajustar»). La **foto de fondo** se recorta (Libre, Original, 1:1, 4:3, 16:9; avisa cuántos lugares quedan fuera y los quita al aplicar) y se gira 90°, y lugares, puntos y tamaños se recolocan solos para seguir sobre lo mismo; todo entra al historial. «Señalar en la imagen» comparte el lienzo: puntos que se arrastran con imán, zoom, reglas, cuadrícula, deshacer, y recortar o girar la foto (con aviso de revisar la precisión). Cada lugar tiene una **clave estable** (`key`; de ella sale su ficha, `imageZoneToken`): las respuestas de los alumnos, en intentos en curso o ya enviados, se conservan al mover lugares (arrastrar, flechas, alinear, repartir) o al recortar o girar la foto; quitar un lugar se lleva su respuesta sin acreditar a otro. Las preguntas de antes no tienen clave y su ficha sale de las coordenadas; el editor, al abrirlas, les pone esas coordenadas de clave, así sus fichas no cambian. Si el examen ya tiene intentos enviados, o la pregunta respuestas guardadas en un intento en curso, cambiar, recortar o girar la foto pide confirmación, diciendo qué pasa con lo ya respondido (en «Señalar», las marcas de los alumnos son coordenadas y no se mueven con la foto). Sin migración: los campos nuevos (`size`, `ratio`, `rotation` y la `key` de cada lugar) son opcionales en `config`. Archivos clave: `src/lib/image-layout.ts` (cajas con giro, guías e imán, alinear, repartir, recolocar; puro), `src/lib/image-processing.ts` y `src/lib/photo-crop.ts` (recortes y giros en el navegador), `src/components/exam/image-pieces.tsx` (ícono puro y silueta) y, en `src/components/teach/exam/`, el lienzo (`image-canvas.tsx`, `image-canvas-toolbar.tsx`, `image-transform-box.tsx`, `use-canvas-zoom.ts`, `use-canvas-tools.ts`, `use-drag-selection.ts`), el historial (`use-editor-history.ts`) y la foto (`image-photo-tools.tsx`, `image-photo-bar.tsx`, `image-crop-cover.tsx`). Prueba: `pnpm smoke:image`.

**Clasificar en grupos y Completar el texto (hecha 2026-09-26)**: Dos tipos de pregunta nuevos; todo va en `questions.config` (sin migración). En **«Clasificar en grupos»** (`categorize`) el maestro arma de 2 a 6 grupos como columnas (el nombre se escribe en la columna; quitar uno con tarjetas pide confirmación) y de 2 a 30 tarjetas de **texto o ícono** (el ícono se sube como en «Arrastrar a la imagen»: solo el dibujo); una tarjeta cambia de grupo arrastrándola o con su menú, y no se permiten dos que se vean iguales (el alumno no las distinguiría). En **«Completar el texto»** (`cloze`) escribe el texto y marca cada hueco con «Hacer hueco», que envuelve la selección en `[[ ]]` (`[[respuesta|variante|!incorrecta]]`, de 1 a 20 huecos), y elige **una forma de contestar por pregunta**: **escribir** (con variantes aceptadas y, si quiere, «Distinguir mayúsculas/acentos»), **banco de palabras** (las respuestas de los huecos más sus distractores, revueltas) o **lista en cada hueco** (la respuesta y sus opciones incorrectas, revueltas). Los dos editores validan en vivo, tienen Deshacer, no dejan guardar con algo escrito sin agregar (así nada se pierde en silencio) y tienen «Ver como alumno» con la solución. El alumno clasifica arrastrando, tocando la tarjeta y luego el grupo, o con el teclado, y el grupo donde caería se ilumina; al completar escribe en cuadros que vacíos miden lo mismo, elige de la lista o pone palabras del banco en huecos del mismo tamaño (ninguno delata la longitud de la respuesta). Cuenta como respondida con todas las tarjetas puestas o todos los huecos llenos. **Sin filtrar la respuesta**: grupos, tarjetas, huecos, palabras y opciones viajan revueltos y como fichas opacas por intento (`categorizeCardToken`, `categorizeGroupToken`, `clozeBlankToken`, `clozeWordToken`, `clozeOptionToken` en `exam-answers.ts`); nunca el grupo de una tarjeta, las variantes ni cuál opción es la correcta. Tarjetas y grupos van por id (reordenar o quitar tarjetas con intentos abiertos conserva las demás respuestas); huecos y opciones, por índice, como en relacionar y ordenar. **Calificación parcial**: cada tarjeta en su grupo vale `puntos / tarjetas` y cada hueco `puntos / huecos`; al escribir se **normaliza** (espacios y, salvo que se exija, mayúsculas y acentos; la ñ siempre cuenta) y vale la respuesta o una variante; en el banco dos palabras iguales son intercambiables y cada ficha cuenta una vez; en la lista cuenta la opción correcta. La revisión muestra cada tarjeta en el grupo donde quedó con ✓ o ✗ y «iba en …» (aparte, las que quedaron sin poner) y el texto con lo contestado en verde, o en rojo tachado con la correcta al lado; el lector de pantalla recibe lo mismo en texto. Si una pregunta de completar **ya tiene respuestas guardadas** en cualquier intento (`clozeQuestionsWithAnswers`), su forma de contestar ya no cambia: el editor lo avisa antes de guardar y propone duplicarla; sin respuestas (nueva, que no salió en el sorteo, recién copiada) sí puede cambiar. **CSV/Excel**: tipos `clasificar` y `completar` y columnas nuevas `grupos` (`Frutas: Manzana; Pera | Verduras: Zanahoria`), `texto` (con `[[ ]]`), `modo` (`escribir`, `banco` o `lista`) y `distractores` (`a | b`). El criterio para exportar y para «reemplazar» pasó de «es de imagen» a **«no cabe en el Excel»** (`csvRepresentable` en `src/lib/csv-fit.ts`): una pregunta de clasificar con alguna tarjeta de ícono no cabe, así que exportar la omite y la cuenta y «reemplazar» la conserva, igual que a las de imagen. **Importar con IA** reconoce los dos tipos (tarjetas solo de texto) y su diálogo de revisión deja corregir grupos, texto, forma de contestar y distractores; el asistente los crea con `formato_excel` y `aplicar_excel`, por el mismo servicio de CSV. Copiar el examen lleva la config y comparte los íconos. Además, las **imágenes del editor se sirven sin su nombre original** (`contentDisposition` en `src/lib/inline-mime.ts`: salen como `imagen.<ext>`), porque el alumno conoce el id de un ícono y un nombre como «verduras-apio.png» le diría la respuesta. Archivos clave: `src/lib/categorize.ts` y `src/lib/cloze.ts` (puros: huecos, normalización, calificación, validación, saneo), `src/lib/categorize-editor-value.ts`, `src/lib/cloze-editor-value.ts` y `src/lib/answer-boards.ts`; en `src/components/student/`, `place-kit.tsx` (piezas compartidas con «Arrastrar a la imagen»), `categorize-control.tsx` y `cloze-control.tsx`; la revisión en `src/components/exam/answer-review.tsx`; el editor en `src/components/teach/exam/` (`categorize-editor.tsx`, `categorize-group.tsx`, `categorize-card-adder.tsx`, `cloze-editor.tsx`, `cloze-chips.tsx`) y la revisión de la IA en `ai-draft-card.tsx`. Nuevos «?» `exam.categorize` y `exam.cloze` junto al tipo en el editor (39 escenas en el catálogo; `src/components/help/scenes/exam-sort-fill.tsx`); las guías del maestro y del alumno los mencionan. Pruebas: `pnpm smoke:categorize` y `pnpm smoke:cloze`.

**Importar preguntas con IA (hecha 2026-09-21)**: El maestro sube un Word, Excel, CSV, PDF, PowerPoint o texto con sus preguntas y OpenAI las **transcribe** (no inventa preguntas ni respuestas) a los 7 tipos. El servidor extrae el texto sin paquetes nuevos (`src/server/services/text-extract.ts`: pdfjs-dist para PDF y LibreOffice para Word/Excel/PowerPoint), lo parte en tramos de ~12 000 caracteres cortando antes de una pregunta, y el diálogo manda un tramo a la vez (`analyzeChunkAction`) con avance y botón Cancelar. OpenAI responde con Structured Outputs (`json_schema` estricto, Responses API); si la respuesta llega mal formada se reintenta una vez. Antes de crear nada el maestro revisa cada pregunta (corrige la correcta con un clic, cambia puntos, quita) y la prueba en «Ver como alumno»: una vista previa en la que puede avanzar sin responder, elegir, ordenar y mostrar las respuestas correctas, sin guardar ni calificar. Las preguntas con problemas se señalan en rojo y se omiten al importar; también puede descargarlas como CSV. Importar (agregar o reemplazar) reusa la misma validación que el editor y el CSV (`src/lib/question-validation.ts`, `src/server/services/exam-import.ts`) y queda en la auditoría. «Ver como alumno» también está en el editor para exámenes ya guardados. La clave de OpenAI vive en Administración → Configuración, cifrada con AES-256-GCM derivada de `APP_SECRET` (solo se muestra enmascarada); sin clave el botón no aparece. Modelo por defecto `gpt-5.6-terra` (editable). El archivo nunca se guarda. Pruebas: `pnpm smoke:ai` (sin gastar) y `pnpm smoke:ai --live` (una llamada real con la clave guardada).

**Importar con IA: varios archivos e imágenes (hecha 2026-09-21)**: El diálogo acepta hasta 5 archivos (10 MB cada uno) y además imágenes (JPG, PNG, WEBP, GIF) y PDF escaneados. Las reglas de selección (límites, tipos, repetidos, mensajes) son puras y viven en `src/lib/ai-import-files.ts`. Los archivos con texto siguen por `ai-extract` y tramos; `ai-extract` ahora responde `{ scanned, pages }` cuando un PDF no tiene texto (`ScannedPdfError`). Las imágenes (todas juntas, en orden, para que una pregunta repartida entre dos fotos llegue completa) y los PDF escaneados de hasta 20 páginas van a la ruta nueva `/api/teach/ai-vision`, que endereza y reduce las fotos a 2048 px en JPEG sin metadatos con `sharp` (`image-prep.ts`, ahora dependencia directa, la misma 0.34.5 que trae Next) y llama a la Responses API con `input_image` / `input_file`, el mismo esquema estricto y el mismo prompt. La guarda del examen se compartió (`exam-access.ts`). Cada pregunta muestra de qué archivo salió; ese dato vive solo en el navegador. HEIC no se lee: el mensaje pide JPG. Se corrigió además un problema previo: el middleware también interceptaba `/api` y Next 15.5 recorta a 10 MB el cuerpo de toda petición que pasa por él (`middlewareClientMaxBodySize`), así que las subidas de más de 10 MB llegaban cortadas sin error; `/api` quedó fuera del matcher. Pruebas: `pnpm smoke:ai` (secciones de archivos, imágenes, PDF escaneado y visión) y `--live` (también lee una imagen).

**Contexto del admin y alumnos por maestro (hecha 2026-09-21)**: El admin es el «profesor general». La base de alumnos es una sola, pero cada maestro ve solo a los suyos (los que dio de alta y los que tienen o tuvieron matrícula en sus cursos) y, de ellos, solo sus cursos, avance y certificados (`src/server/services/student-scope.ts`). Al inscribir, el buscador encuentra a cualquier alumno (nombre, correo y estado), y `enrollStudents` solo acepta cuentas con rol alumno. Cuenta del alumno (`studentAccountPermissions`): cualquiera de sus maestros la reactiva; restablecer la contraseña y desactivarla solo si el alumno está únicamente con ese maestro (si es compartido, solo el admin). Restablecer, activar, desactivar e inscribir quedan en la auditoría. Las listas reciben un `ViewScope` (`src/server/auth/view-scope.ts`: own | teacher | all) en lugar de «si es admin, todo»; los permisos (`getOwnedCourse`, `canManageCohort`, `ownedPending`…) no cambian, y los selectores de permiso (plantilla del curso, importar grupo) usan `fullScope`. El admin elige el contexto en un selector junto a la campana («Mi contenido», «General — todos», «Ver como maestro X», con conteos de una sola consulta agregada `visibleStudentCountsByOwner`) y ve una franja «Volver a Mi contenido». Se guarda en la cookie `vista` (`setViewContextAction`), que el middleware quita en cada carga completa del documento fuera de `/api` y de las páginas públicas (`isDocumentLoad` en `src/lib/view-context.ts`; Next quita la cabecera `RSC` antes del middleware, así que deciden `Sec-Fetch-Dest` y `Accept`), además de al iniciar y cerrar sesión: siempre se arranca en «Mi contenido». Los buscadores usan `Form` de `next/form` para no provocar cargas completas. Las pestañas se sincronizan con `BroadcastChannel` (y `pageshow` para el bfcache). Lo que se crea viendo como un maestro queda a su nombre (auditoría con `onBehalfOf`); un CSV que inscribe en un curso crea a los alumnos a nombre del dueño del curso. La campana y los números del menú siempre cuentan solo lo propio. En «General» los cursos llevan la etiqueta de su dueño. El nombre del alumno, el título del curso y el nombre del maestro quedan fijos en el certificado al emitirse (`template_snapshot`); los ya emitidos se completan al arrancar (`src/instrumentation.ts`) o con `pnpm certs:backfill` (alias `certs:backfill-teacher`). Sin migración. Prueba: `pnpm smoke:scope` (incluye el middleware en proceso).

**Archivos por maestro, diplomas fijos y títulos en celular (hecha 2026-09-21)**: `/api/files` ya revisa a los maestros: cada uno abre solo los archivos de sus cursos (documentos, recursos, adjuntos, entregas, certificados, fondos de plantilla propias o que use un curso suyo, imágenes de pregunta) más lo que subió él; portadas, identidad e imágenes pegadas en textos siguen abiertas (`src/server/services/file-access.ts`). Enlazar un documento, recurso o adjunto exige que el archivo lo haya subido quien edita (o el admin) y del tipo correcto, para que nadie enganche a su curso el archivo de otro. Además, `/api/files` manda `X-Content-Type-Options: nosniff` y solo muestra en el navegador PDF, imágenes (sin SVG), video y audio; lo demás se descarga (`src/lib/inline-mime.ts`), así un HTML subido no puede correr código. Los diplomas fijan al emitirse también el nombre del alumno y el título del curso (`backfillCertificateSnapshots`, `pnpm certs:backfill`). En celular el título de cada página se muestra en hasta dos líneas. La migración 0009 agrega índices en las columnas `*_file_id` para que esa revisión busque directo por archivo.

**Guía de primeros pasos (hecha 2026-09-21)**: Banda de una línea en el Inicio del maestro (`src/components/teach/onboarding-band.tsx`) con los 5 primeros pasos (curso, lección, estudiantes, matricular y publicar, diploma), marcados solos con los datos propios (`src/server/services/onboarding.ts`; regla pura en `src/lib/onboarding.ts`). El admin la ve solo en «Mi contenido». «Ver todos» despliega la lista; «Ocultar» la guarda en localStorage por usuario y deja un enlace de recuperación; desaparece al completarse. Cada botón lleva a la acción ya lista: abre «Nuevo curso» o «Nuevo estudiante», despliega el menú «+ Agregar» del contenido (`?agregar=1`), abre «Matricular estudiantes» (`?matricular=1`) o desplaza y resalta el bloque del certificado (`#diploma`). En la misma página no navega: avisa al diálogo con un evento (`src/lib/open-dialog.ts`), porque Next descarta la navegación que solo cambia la búsqueda. Prueba: `pnpm smoke:scope`.

**Asistente de IA, entrega 1 (hecha 2026-09-22)**: campo blanco centrado en el encabezado y panel lateral no modal donde admin y maestros hablan con la IA. La IA solo elige herramientas de un catálogo (`src/server/assistant/tools/`): `buscar_alumno`, `buscar_curso`, `ficha_alumno`, `resumen_curso`, `ir_a`, `matricular` y `desmatricular`; cada una llama a los servicios existentes con los permisos del contexto de vista. Un alumno se matricula al momento con «Deshacer» (10 min); varios pasan por una tabla de revisión editable (`ai_proposals`), que se revalida al aplicar y escribe en la auditoría con `via: "assistant"`. Conversaciones privadas por usuario con historial (`ai_conversations`, `ai_messages`; migración 0010). A la IA solo van resúmenes de texto (nunca listas crudas) y los últimos 6 mensajes. Pruebas: `pnpm smoke:assistant` con OpenAI simulada. Pendiente (entregas 2 y 3): adjuntos y altas/bajas en lote, cursos en lote, consultas y descargas, sugerencias sin tokens, resumen de conversación y modelo rápido.

**Asistente de IA, entrega 2 (hecha 2026-09-22)**: el asistente acepta archivos (arrastrar a la ventana o el clip): Excel, CSV, Word, PDF, PowerPoint e imágenes, hasta 10 MB y 3 por mensaje. El servidor los lee y arma un resumen (hojas, filas, columnas, muestra y colores) que es lo único que ve la IA; el archivo completo se procesa aparte y las hojas de cálculo se leen mapeando columnas por encabezado, sin gastar tokens. Herramientas nuevas, todas con tabla de revisión: `alta_alumnos` (crea cuentas con las reglas del CSV, y con curso matricula también a quienes ya existían), `baja_alumnos` (deshabilitar, o borrar definitivamente solo el administrador y escribiendo BORRAR) y `crear_cursos` (nacen en borrador con su vigencia). Las filas se pueden filtrar por el color con que están pintadas («da de baja a los que están en rojo»): LibreOffice exporta la hoja a HTML con el relleno de cada celda y los nombres de hoja salen del propio archivo (`src/server/services/sheet-colors.ts`). Adjuntos en `ai_attachments` (migración 0011). Pendiente (entrega 3): consultas y descargas, sugerencias por estado de la plataforma, resumen de conversación y modelo rápido.

**Asistente de IA, entrega 3 (hecha 2026-09-22)**: el asistente responde preguntas con cifras calculadas por la plataforma, nunca por la IA: `movimientos` (entregas, exámenes, aprobados y certificados de un rango de fechas en palabras: «hoy», «esta semana», «del 1 al 15»), `pendientes` (sin entrar, sin entregar, reprobados según el mínimo de cada examen), `certificados` (emitidos, por vencer o vencidos) y `panorama` por maestro, solo para el admin en «General — todos». Cada consulta deja un CSV descargable (`ai_exports`, migración 0012) que solo abre su dueño y caduca en 24 horas, servido por `/api/assistant/export/[id]`; también se descargan los certificados en ZIP y las contraseñas de un alta. Al abrir el panel en blanco propone hasta tres cosas que atender (certificados por vencer, pendientes de calificar, alumnos que no han entrado…), calculadas sin gastar tokens. Para gastar menos: la conversación se resume cada 10 mensajes y en Configuración → Inteligencia artificial se puede fijar un «modelo para conversación» más barato, distinto del que lee archivos. Límite de 20 turnos y 20 archivos por usuario cada 5 minutos. También `reactivar_alumnos`.

**Asistente de IA, entrega 4 — Excel a la medida (hecha 2026-09-23)**: el asistente genera y recibe archivos de Excel de verdad, con formato y números reales, sin dependencias nuevas: se arma un FODS (XML plano) y LibreOffice lo convierte a `.xlsx` (`src/server/services/xlsx.ts`). `listado` arma la lista que se pida con filtros combinables (curso, grupo, estado, avance mínimo y máximo, con o sin certificado, fechas, orden) sobre alumnos, matrículas o certificados, y la entrega en tabla, Excel —con encabezado de color, reprobados y vencidos en rojo, porcentajes numéricos— y CSV. `formato_excel` devuelve el formato listo para llenar de alumnos, cursos, matrícula, lecciones o preguntas de examen (los dos últimos con los datos actuales del curso) con su hoja de Notas. `aplicar_excel` reconoce por los encabezados qué formato le sueltan y aplica matrícula, propiedades de lecciones o preguntas con la tabla de revisión de siempre; con un examen pregunta antes si reemplaza o agrega, para no duplicar las preguntas. `reporte_avance` exporta la matriz del curso con una columna por lección y colores por estado, más una hoja de resumen con las lecciones que peor van; `reporte_periodo` resume un periodo y detalla sus movimientos. Las descargas pueden ser archivos (migración 0013: `ai_exports` con `file_id` y `mime`). De paso se corrigió que el CSV de Reportes exportaba solo a los primeros 100 alumnos.

**Asistente de IA, entrega 5 — movimientos y revisiones (hecha 2026-09-23)**: el asistente ya no solo informa, también mueve lo que se mueve a diario y revisa lo que antes había que rastrear a mano. Movimientos: `grupos` (crear, mover, renombrar, cerrar, reabrir, borrar con palabra de confirmación; crea el grupo al vuelo si no existe), `restaurar` (sacar de la papelera las bajas de un curso, con su progreso), `avisar` (manda un aviso a la campana de los alumnos —tipo `teacher_notice`, con vista previa y tope de 500—, a un curso, un grupo, a quienes no han entrado o no han entregado), `recertificar` (abre el ciclo nuevo a quienes les vence el certificado), `publicar_curso`, `asignar_diploma`, `fecha_limite` (de una tarea o de todas), `duplicar_curso` (copia profunda en borrador, sin alumnos) y, solo para el admin, `reasignar_curso` (con palabra de confirmación) y `crear_maestro` (deja los datos de acceso como descarga). Revisiones: `historial` (lee la bitácora de auditoría en español: quién, qué y sobre qué; el maestro solo ve lo suyo), `revisar_curso` (qué le falta al curso para publicarse o funcionar, con enlaces) y `revisar_alumno` (qué condición de aprobación no cumple y por qué no le sale el certificado, usando el motor de reglas real). Son 35 herramientas en total; lo único que el asistente sigue sin hacer es crear plantillas de diploma, calificar y editar el contenido de una lección. De paso se corrigieron dos huecos de la plataforma: no se puede publicar un curso sin lecciones (antes el botón lo permitía) y la emisión de certificados queda registrada en la auditoría.

**Pool general de alumnos (hecha 2026-09-23)**: el alumno que registra cualquier maestro queda disponible para todos; nadie vuelve a darlo de alta. `student-scope.ts` separa dos reglas sobre la misma base: el **pool** (`studentInPoolCondition`, `isStudentInPool`: toda cuenta con rol alumno), que sirve para buscar, abrir la ficha y matricular, y **mis alumnos** (`studentVisibleCondition` / `ownStudentSql`: alta propia o matrícula en mis cursos), que sigue rigiendo reportes, avisos, historial, certificados, recertificar, restaurar, conteos y los permisos sobre la cuenta. «Estudiantes» abre en «Todos los alumnos» con la pestaña «Mis alumnos» al lado (`?lista=mios`; en «General» no hay pestañas); `listStudents` acepta `pool` y devuelve `mine` por fila, y la columna «Cursos» cuenta solo los del contexto. La ficha (`getStudentProfile`, ya sin parámetro `access`) abre a cualquier alumno del pool, pero cursos, avance, tiempo y certificados siguen filtrados por el contexto; de los demás maestros solo se dice cuántos cursos toma. El menú de cuenta (restablecer, activar, desactivar) solo aparece si el alumno es tuyo (`studentAccountPermissions().mine`, antes `visible`), con las mismas reglas de alumno compartido. Registrar un correo que ya es de un alumno no da error: `createStudent` lanza `ExistingStudentError` y el diálogo ofrece «Matricular en cursos» sobre el existente. En el asistente, `buscar_alumno` busca en el pool y marca a quien aún no está en tus cursos, `matricular` ya no bloquea con «No es uno de tus alumnos» y `ficha_alumno` abre como la página; las demás herramientas no cambian. Sin migración. Pruebas: `pnpm smoke:scope` (sección «Pool general de alumnos») y `pnpm smoke:assistant`.

---

## 10. Qué copiar vs. qué evitar (resumen de investigación)

| ✅ Copiar | ❌ Evitar |
|---|---|
| Jerarquía Curso→Carpeta→Ítem con drag & drop (LearnDash) | Runtime SCORM/xAPI/LRS propio |
| Flag "lineal vs. libre" por curso + override por ítem | Candados condicionales manuales estilo Moodle Restrict Access |
| Completado ≠ Aprobado (cmi5/iSpring) | Anidación ilimitada de carpetas |
| Intervalos de video con merge + seek bloqueado solo hacia adelante | Ocultar todos los controles del video |
| PPT→PDF (LibreOffice) + pdf.js + tiempo mínimo por página | Visor nativo de PPTX en browser |
| Pool aleatorio + shuffle + intentos + ventana + tiempo límite | Proctoring IA/webcam, lockdown browser |
| 6 tipos de pregunta básicos (hoy son 11: se sumaron «Ordenar pasos», «Arrastrar a la imagen», «Señalar en la imagen», «Clasificar en grupos» y «Completar el texto») | ~~Cloze, drag-drop sobre imagen~~, preguntas matemáticas. **Cambio de criterio:** el plan original dejaba fuera de la v1 el cloze y el arrastre sobre imagen; se pidieron después («Arrastrar a la imagen» y «Señalar en la imagen», 2026-09-24; «Completar el texto» y «Clasificar en grupos», 2026-09-26) y se hicieron con las mismas garantías que los básicos: al navegador solo viajan fichas opacas por intento (nunca la respuesta), calificación parcial y CSV/Excel donde caben (lo que no cabe se omite y se cuenta). Las preguntas matemáticas siguen fuera. |
| % visualización + % exámenes configurables por curso | Gradebook complejo estilo Moodle |
| Notificaciones por evento + recordatorios de fecha límite | Motor de workflows genérico |
| Plantilla de certificado con variables + folio + `/verify` + QR | Blockchain, Open Badges, firmas criptográficas |
| "Continuar donde quedaste", matriz con semáforo, export CSV | Leaderboards globales, economía de puntos |

---

## 10.5 Operación masiva (CSV/Excel) y trazabilidad

Todas las operaciones masivas siguen el mismo contrato: **exportar → editar en
Excel → subir → previsualizar cambios fila por fila → aplicar**. Formato CSV
UTF-8 con BOM (Excel abre acentos bien), acepta separador `,` o `;` (Excel-ES).
Nada se aplica sin pasar por la pantalla de revisión con conteos y motivos de
rechazo por fila.

| Operación | Servicio | Columnas clave |
|---|---|---|
| Preguntas de examen | `exam-csv.ts` | tipo, pregunta, puntos, opcion_1..6, correctas (`2` o `1\|3` o `V/F`), respuestas_aceptadas (`a\|b`), pares (`izq=der \| ...`) — modos reemplazar/agregar |
| Propiedades de lecciones | `bulk-lessons.ts` | id (inmutable), titulo, requerido SI/NO, secuencia heredar/obligatoria/libre, visible, segundos_minimos |
| Matrícula del curso | `bulk-roster.ts` | correo, accion matricular/quitar (vacío = mantener); re-matricular reactiva bajas conservando progreso |
| Alta de estudiantes | `csv-import.ts` (F4) | nombre, correo, contrasena (vacía = autogenerada) |
| Certificados físicos | `/api/certificates/zip` | ZIP streaming `<curso>/<folio>-<estudiante>.pdf`, global o por curso; PDF individual por fila |

**Trazabilidad**: cada import/export masivo y descarga de ZIP escribe en
`audit_log` (quién, qué, cuántos, cuándo) — visible en Administración →
Configuración → Auditoría. Los certificados nunca pierden su folio verificable.

**Señalización visual por tipo de contenido** (rompe la monocromía café):
documento azul `#1E43BC` · video fucsia `#D33BE0` · examen bermellón `#D55E00`
· tarea teal `#0D9488` · lectura café. Paleta validada contra daltonismo
(todos los pares ΔE ≥ 8.3) y SIEMPRE acompañada del icono del tipo. El café
queda como color de marca/acciones; verde/ámbar/rojo siguen siendo semánticos.

## 11. Requisitos del servidor y notas de escala

**Escala objetivo**: 1,000–5,000 usuarios registrados, ~100 concurrentes.

- **SQLite aguanta sobrado**: ~100 concurrentes con heartbeat cada 10 s ≈ 10 escrituras/seg; WAL + better-sqlite3 (proceso único) maneja miles/seg. Los heartbeats hacen un solo UPDATE por fila de progreso (bitmap/intervalos), no insertan histórico.
- **Sin video alojado, el servidor respira**: el tráfico pesado (video) va a YouTube/Vimeo; el servidor solo sirve PDFs y la app. **Hardware recomendado**: CPU 4+ núcleos, 8–16 GB RAM, SSD de 250 GB+ (documentos y entregas), red estándar de la LAN.
- Los equipos cliente necesitan **internet solo para ítems de video** (embeds); todo lo demás funciona 100% en LAN.
- PC Windows con Node.js LTS, **LibreOffice** instalado (confirmado; ruta en `.env`), puerto 3000 abierto en firewall.
- Servicio de Windows vía NSSM para arranque automático.
- Backup diario automatizado: copiar `data.db` + carpeta `storage/` a otra ubicación (con 5k usuarios el `.db` seguirá siendo de decenas de MB; el peso está en `storage/`).

**Decisiones cerradas**:
- Notificaciones solo in-app (campana en el header + badge de no leídas). El modelo `notifications` queda listo para agregar email después si la empresa monta servidor de correo interno.
- Con 1k–5k estudiantes, las vistas de listados (estudiantes, matriz de progreso) se diseñan **paginadas y con búsqueda desde el día uno** — no listas completas en memoria.
- Alta masiva de estudiantes: además del alta individual, **importación por CSV** (nombre, email, contraseña inicial) — con miles de empleados, capturar uno por uno no es viable. Se agrega a Fase 4.
