# DISEÑO-UX.md — Plataforma de Aprendizaje

> Documento de diseño UX. Fuentes de verdad: `PLANEACION.md` (funcional) y la sección 0 de este documento (visual).
> Stack UI: Next.js 15 + Tailwind + shadcn/ui + dnd-kit + Lucide. Densidad de dashboards: "Data-Dense moderada" (sidebar 240px, header 56px) con la paleta de la sección 0.
> Principios rectores: **máx. 2 clics a cualquier cosa · cero jerga técnica · lo bloqueado se muestra con candado, no se oculta · "Continuar donde te quedaste" es el rey del dashboard.**

---

## 0. Fundamentos visuales aplicados

> **PALETA v3 (vigente) — Dirección B: sidebar azul noche + cabeceras vivas.**
> Sustituye a la v2 café (2026-07-28).
>
> - Neutros slate (fondo `#F8FAFC`, texto `#0F172A`), **índigo `#4F46E5`** como
>   color de acción (botones, links, focus). Sidebar degradado `#0F172A→#1E1B4B`.
> - **Un color por SECCIÓN**, aplicado automáticamente por la ruta vía
>   `[data-section]` (Inicio índigo · Cursos cielo · Por calificar ámbar ·
>   Estudiantes esmeralda · Reportes violeta · Certificados rosa · Admin slate).
>   Tokens: `bg-section`, `text-section-strong`, `bg-section-soft`,
>   `.section-gradient`. Componentes: `SectionScope` (franja superior en todas
>   las pantallas), `PageHeader` (cabecera con acento), `NavLink` (chips de
>   color en el menú).
> - Tipografía **Sora** (títulos) + **Inter** (cuerpo).
> - Semánticos intactos (verde/ámbar/rojo) y colores por tipo de lección
>   intactos (validados CVD).
> - Certificados PDF: paleta de impresión azul noche `#1E1B4B` + dorado
>   `#C9A227`; 7 presets de adornos (clásico, elegante, moderno, sello,
>   corporativo, académico, minimalista).

### Histórico v2 (café) — sustituido


> **PALETA v2 (vigente) — identidad corporativa CAFÉ OSCURO.** La paleta cyan
> original quedó sustituida el 2026-07-27. Regla de oro: **el café es la marca
> (acciones, navegación, títulos); el verde es semántico (completado/aprobado/
> éxito) y nunca se usa como marca**. Tokens en `src/app/globals.css`.

| Token | Valor v2 | Uso |
|---|---|---|
| `--primary` / `--cta` | `#5D4037` (café oscuro) | Marca: botones primarios, navegación activa, links, focus ring, títulos destacados |
| `--background` | `#FAF7F4` (crema cálido) | Fondo de página; cards en blanco `#FFFFFF` |
| `--foreground` | `#43302B` | Texto principal (11.9:1 sobre blanco) |
| `--success` / `--progress-ring` | `#16A34A` / `#22C55E` | Completado, aprobado, toasts de éxito, anillos de progreso |
| `--warning` | `#D97706` | Fechas próximas, cola de calificación, atrasos |
| `--destructive` | `#DC2626` | Errores, vencido, revocado |
| `--locked` | `#A8968A` | Ítems con candado |
| `--brand-deep` / `--brand-soft` / `--brand-tint` | `#3E2B23` / `#B08968` / `#F5EDE6` | Decorativos: gradientes, chips de icono, resaltado del ítem activo, etiquetas de sección |

**Identidad configurable**: el admin puede subir el logo de la empresa y cambiar
el nombre de la plataforma (Administración → Configuración → Identidad). El logo
aparece en header, login, Focus Mode y `/verify` (público). PNG/JPG/WEBP, máx 2 MB
(SVG prohibido por seguridad).

**Animaciones del sistema** (`globals.css`, todas con `prefers-reduced-motion`):
`.anim-rise` (entrada 280 ms), `.anim-pop`, `.anim-d1..d5` (stagger de listas),
`.card-lift` (elevación al hover), `.brand-gradient` / `.brand-gradient-text`.

**Color por TIPO de contenido** (v2.1 — señalización, validada CVD todos los
pares ΔE ≥ 8.3; SIEMPRE icono + color, nunca color solo):

| Tipo | Color | Tint | Icono |
|---|---|---|---|
| Documento | `--kind-document` #1E43BC | `-tint` | FileText |
| Video | `--kind-video` #D33BE0 | `-tint` | Play |
| Examen | `--kind-exam` #D55E00 | `-tint` | FileQuestion |
| Tarea | `--kind-assignment` #0D9488 | `-tint` | Upload |
| Lectura | `--kind-text` (café) | `-tint` | AlignLeft |

Se aplica en: iconos de árboles (estudiante y editor), borde izquierdo de filas
del editor, encabezados de la matriz, chips de lección en el visor, badges de
tipo de pregunta. Las carpetas son neutras café y actúan como encabezados de
sección (fondo `bg-secondary`) — las "divisiones" visuales del contenido.
En gráficas de estadísticas las barras de una sola medida usan UN matiz (café);
la identidad la dan etiqueta + KindChip, jamás una barra de cada color.

Tipografía: **Poppins** (600) para títulos y KPIs; **Open Sans** (400/600) para cuerpo, tablas y formularios. Cuerpo mínimo 14px en tablas densas, 16px en lectura.

Ajuste de contraste sobre la paleta base: el botón verde `#22C55E` con texto blanco da ~2.2:1 (falla AA). **Regla del sistema: botones CTA usan verde `#16A34A` con texto blanco (4.5:1)**; `#22C55E` queda para anillos de progreso, checkmarks e indicadores no textuales (donde aplica 3:1 de componentes UI). Nada de dark mode (anti-patrón declarado del sistema visual).

Radios: cards 12px, botones/inputs 8px. Sombras según los tokens del tema. Transiciones 150–200ms, con `prefers-reduced-motion` respetado globalmente.

---

## 1. Arquitectura de navegación por rol

### 1.1 Modelo general

- **Shell de app** (todas las vistas autenticadas excepto el visor de lección): header fijo 56px + sidebar izquierdo fijo 240px (colapsable a 64px solo-iconos con tooltip; estado persistido en `localStorage`).
- **Sidebar a la izquierda, ítems alineados a la izquierda** (sesgo de atención al lado izquierdo; nunca navegación centrada).
- **Focus Mode** (visor de lección del estudiante): el shell global desaparece; la navegación es el árbol del curso (ver §2.3–2.4). Es el único lugar con navegación propia.
- Profundidad máxima de navegación: **2 niveles**. Todo lo demás se alcanza por contexto (tabs dentro de un curso) o búsqueda.

### 1.2 Header global (56px, igual para todos los roles)

```
┌────────────────────────────────────────────────────────────────────────────┐
│ [logo empresa]  [Migas de pan.......................]   [🔔] [Avatar ▾]    │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Izquierda**: logo (link al dashboard del rol) + breadcrumbs.
- **Derecha, en este orden**: campana de notificaciones, menú de usuario. Nada más — sin buscador global en v1 (la búsqueda vive dentro de cada listado).
- **Campana** (`Bell`): badge numérico verde con no-leídas (máx "9+"). Clic → popover 380px: lista de notificaciones (icono por tipo, título, hace cuánto), "Marcar todas como leídas", cada ítem navega a su destino (ej. `assignment_submitted` → cola de calificación con esa entrega abierta). Iconos por tipo: `Award` (certificado), `BadgeCheck` (curso completado), `CalendarClock` (recordatorio de fecha límite), `Upload` (tarea entregada), `ClipboardCheck` (por calificar).
- **Menú de usuario** (avatar con iniciales + `ChevronDown`): nombre completo, email, rol actual → separador → "Mi perfil" (`User`), "Cambiar contraseña" (`KeyRound`) → **selector de contexto si aplica (ver 1.6)** → separador → "Cerrar sesión" (`LogOut`, en rojo).

### 1.3 Sidebar ESTUDIANTE (240px)

Deliberadamente mínimo — el estudiante viene a aprender, no a administrar:

| Orden | Ítem | Icono Lucide | Ruta |
|---|---|---|---|
| 1 | Inicio | `House` | `/dashboard` |
| 2 | Mis cursos | `BookOpen` | `/dashboard#cursos` (misma página, ancla) |
| 3 | Mis certificados | `Award` | `/dashboard#certificados` |

Sí, tres ítems que apuntan a un solo dashboard largo: **para el estudiante, el dashboard ES la app**. Evita páginas fantasma con 2 cards. Si en el futuro los certificados crecen, se separa la ruta sin romper el modelo mental.

### 1.4 Sidebar MAESTRO (240px)

| Orden | Ítem | Icono | Ruta |
|---|---|---|---|
| 1 | Inicio | `House` | `/teach/dashboard` |
| 2 | Mis cursos | `BookOpen` | `/teach/courses` |
| 3 | Por calificar | `ClipboardCheck` + badge numérico | `/teach/grading` (vista global, agrupada por curso) |
| 4 | Estudiantes | `Users` | `/teach/students` |
| 5 | Reportes | `BarChart3` | `/teach/reports` |
| 6 | Certificados | `FileBadge` | `/teach/templates` |

- El badge de "Por calificar" es el mismo dato que alimenta la campana; verlo fijo en el sidebar es lo que hace que el maestro no acumule cola.
- **Dentro de un curso** la navegación de segundo nivel son **tabs horizontales** bajo el título del curso (no sub-sidebar): `Contenido · Estudiantes · Reglas de aprobación · Calificación · Ajustes`. Máximo un nivel de tabs — cumple los 2 clics: sidebar → curso → tab.

### 1.5 Sidebar ADMIN

El admin ve el sidebar de maestro **más** una sección separada por divisor con etiqueta "Administración" (texto 11px, mayúsculas, gris):

| Ítem | Icono | Ruta |
|---|---|---|
| Usuarios | `UserCog` | `/admin/users` |
| Todos los cursos | `Library` | `/admin/courses` |
| Configuración | `Settings` | `/admin/settings` |

### 1.6 Maestro-que-también-es-admin: cambio de contexto

No hay "modo admin" con toggle global (introduce estados invisibles y confusión). En su lugar:

1. El rol `admin` **siempre** ve ambas secciones del sidebar (1.4 + 1.5). El contexto es la página, no un modo.
2. En el menú de usuario, bajo el nombre, un chip estático indica "Administrador".
3. Las páginas de administración llevan una franja sutil bajo el header (borde superior cyan 2px + texto "Estás en administración — los cambios afectan a toda la plataforma") solo en acciones destructivas (borrar usuario, archivar curso ajeno).

Un admin que da clases usa las mismas rutas `/teach/*` que cualquier maestro; en `/admin/courses` ve los cursos de todos con columna "Propietario". Cero fricción, cero cambio de identidad.

### 1.7 Breadcrumbs

- Formato: `Inicio / Mis cursos / Seguridad Industrial / Contenido`. Separador `ChevronRight` 14px gris.
- Siempre visibles en el header (truncando el título del curso con ellipsis + tooltip si excede).
- **Excepción**: en Focus Mode del estudiante no hay breadcrumbs; hay botón "← Volver al curso" (ver §2.3).
- El último segmento no es link (aria-current="page").

---

## 2. Especificación pantalla por pantalla

Convención de wireframes: `[ ]` = botón, `(o)` = radio, `[x]` = check, `▓` = énfasis/activo, `⬤◔` = anillo de progreso, iconos entre `<>` son Lucide.

### 2.1 Login — `/login`

Patrón "Minimal Single Column", único lugar donde aplica tal cual:

```
                    fondo #ECFEFF
        ┌──────────────────────────────────┐
        │          [logo empresa]          │
        │   Plataforma de Capacitación     │  ← Poppins 24px
        │                                  │
        │  Correo electrónico              │
        │  [___________________________]   │
        │  Contraseña                      │
        │  [___________________________👁] │  ← toggle Eye/EyeOff
        │                                  │
        │  [      Entrar (verde)      ]    │  ← ancho completo, 44px alto
        │                                  │
        │  ¿Problemas para entrar?         │
        │  Contacta a tu instructor.       │  ← texto 13px gris
        └──────────────────────────────────┘
```

- Card blanca 400px máx., centrada vertical. Sin registro público (las cuentas las crea el maestro), sin "olvidé mi contraseña" por email (no hay correo): el copy dirige al instructor, que puede resetear desde el CRUD.
- Error: banner rojo dentro de la card, "Correo o contraseña incorrectos" (sin distinguir cuál — seguridad), el campo no se limpia.
- Al entrar: redirección por rol (`student → /dashboard`, `teacher/admin → /teach/dashboard`).
- Enter envía; autofocus en email; `autocomplete` correcto para gestores de contraseñas.

### 2.2 Dashboard estudiante — `/dashboard`

```
┌─ sidebar ─┬────────────────────────────────────────────────────────────────┐
│ ▓ Inicio  │  Hola, Laura                                    <Bell> <avatar>│
│  Cursos   │                                                                │
│  Certif.  │  ┌──────────────────────────────────────────────────────────┐  │
│           │  │ <PlayCircle>  CONTINUAR DONDE TE QUEDASTE                │  │
│           │  │ Seguridad Industrial › Módulo 2 › Manejo de extintores   │  │
│           │  │ ▓▓▓▓▓▓▓▓▓░░░░░░ 62% del curso                            │  │
│           │  │                              [ Continuar → ] (verde)     │  │
│           │  └──────────────────────────────────────────────────────────┘  │
│           │                                                                │
│           │  ⚠ Fechas próximas                                             │
│           │  <CalendarClock> Examen final de Ventas — cierra en 2 días     │
│           │                                                                │
│           │  Mis cursos                                                    │
│           │  ┌────────────┐ ┌────────────┐ ┌────────────┐                  │
│           │  │ [portada]  │ │ [portada]  │ │ [portada]  │                  │
│           │  │ Seguridad  │ │ Ventas B2B │ │ Inducción  │                  │
│           │  │ ⬤◔ 62%     │ │ ⬤ 100% ✓   │ │ ⬤○ 0%      │                  │
│           │  │ [Continuar]│ │ [Repasar]  │ │ [Empezar]  │                  │
│           │  └────────────┘ └────────────┘ └────────────┘                  │
│           │                                                                │
│           │  Mis certificados                                              │
│           │  <Award> Ventas B2B — CERT-2026-000123-K7QX — 12 mar 2026      │
│           │          [ Descargar PDF ]  [ Ver verificación ]               │
└───────────┴────────────────────────────────────────────────────────────────┘
```

- **"Continuar donde te quedaste"** es el hero: card grande, borde izquierdo verde 4px, único CTA verde grande de la vista. El botón lleva **directo al ítem** (`/courses/x/items/y`), no al índice del curso. Si no hay nada en progreso: la card muta a "Empieza tu siguiente curso" con el primer curso 0%. Si todo está completo: "¡Todo al día!" + icono `CircleCheck` verde + link a certificados.
- Cards de curso: anillo de progreso 40px (verde; gris si 0%; check `Check` blanco en centro si 100%), fecha límite más próxima en ámbar si existe. El botón cambia de verbo según estado: Empezar / Continuar / Repasar.
- Fechas próximas solo aparece si hay exámenes/tareas con cierre ≤ 7 días.
- Certificados: lista compacta, folio en Open Sans (no monospace — evitamos estética técnica, y el folio ya es legible).

### 2.3 Vista de curso del estudiante — `/courses/[id]` (índice) y Focus Mode

**Índice del curso** (`page.tsx`): header con portada, título, descripción, barra de progreso global, desglose de aprobación ("Te falta: Examen 2 — 65% < 80%") y botón verde "Continuar". Debajo, el mismo árbol del sidebar en versión de página completa. Es la vista de "mapa"; a partir de que el alumno abre un ítem, vive en Focus Mode.

**Focus Mode** (layout de `/courses/[id]/items/[itemId]`, tipo LearnDash):

```
┌──────────────────────────────────────────────────────────────────────────┐
│ ← Volver al curso   Seguridad Industrial            ▓▓▓▓▓░░ 62%  <Bell>  │ ← header propio 56px
├──────────────────┬───────────────────────────────────────────────────────┤
│ CONTENIDO        │                                                       │
│                  │                                                       │
│ ▾ Módulo 1       │                                                       │
│   ✓ Bienvenida   │              [ ÁREA DE LA LECCIÓN ]                   │
│   ✓ Normativa    │        (visor doc / video / texto / examen)           │
│ ▾ Módulo 2       │                                                       │
│   ✓ Riesgos      │                                                       │
│  ▓● Extintores   │  ← actual: fondo cyan 10%, borde izq. cyan 3px        │
│   🔒 Evacuación  │  ← candado gris + tooltip "Completa Extintores        │
│ ▾ Módulo 3       │     para desbloquear"                                 │
│   🔒 Examen final│                                                       │
│                  ├───────────────────────────────────────────────────────┤
│                  │  [← Anterior]                       [Siguiente →]     │ ← barra inferior fija
└──────────────────┴───────────────────────────────────────────────────────┘
```

- Sidebar del curso 280px, colapsable (`PanelLeftClose`), estado persistido. Iconos de estado a la izquierda del título: `CircleCheck` verde relleno (completado), `CircleDot` cyan (en progreso), `Circle` gris (disponible), `Lock` gris (bloqueado, con tooltip accesible por focus, no solo hover).
- Icono de tipo a la derecha del título, 14px gris: `FileText` (documento), `Play` (video), `AlignLeft` (texto), `FileQuestion` (examen), `Upload` (tarea). Duración/páginas como subtexto ("12 páginas · ~4 min").
- Clic en ítem bloqueado: no navega; muestra el tooltip y un shake sutil de 150ms (desactivado con reduced-motion). El backend valida igual (`canAccess`).
- Barra inferior: "Siguiente" navega al siguiente ítem del orden DFS; deshabilitado (gris + tooltip con la razón) si el actual no está completo y la secuencia es `required`.

### 2.4 Visor de documento (pdf.js) — ítem `document`/`text`

```
├─ árbol ─┬────────────────────────────────────────────────────────────────┤
│         │  Manejo de extintores          Página 5 de 12   <Maximize2>    │
│         │  ▓▓▓▓▓▓░░░░░░░░░░  ← progreso de páginas ACREDITADAS           │
│         │ ┌────────────────────────────────────────────┐                 │
│         │ │           [ PÁGINA PDF RENDERIZADA ]       │  ← una página,  │
│         │ │                                            │    sin scroll   │
│         │ └────────────────────────────────────────────┘                 │
│         │  [← Anterior]   ⏱ 3s              [Siguiente →]                │
│         │                 └ anillo de cuenta regresiva                   │
└─────────┴────────────────────────────────────────────────────────────────┘
```

- **Página por página, no scroll** (requisito de tracking). Zoom fit-width por defecto, controles `ZoomIn`/`ZoomOut`/`Maximize2` (pantalla completa).
- **Botón "Siguiente" y tiempo mínimo**: al entrar a una página no acreditada, el botón muestra un mini-anillo de cuenta regresiva (`min_seconds_per_page`, default 3s) y está deshabilitado con tooltip "Un momento… estamos registrando tu lectura". Al cumplirse: transición a verde habilitado 200ms. En páginas ya acreditadas, navegación libre e instantánea (releer nunca castiga).
- La barra de progreso superior pinta páginas acreditadas (bitmap), no la posición: el alumno ve exactamente qué le falta.
- Al acreditar la última página: toast verde "Lección completada", checkmark del árbol se anima (scale 0.8→1), y "Siguiente ítem" se habilita en la barra inferior. **Sin modal intermedio** — el alumno está en flujo.
- Reanudar: siempre abre en `current_page` guardada.
- Ítem `text`: mismo chasis pero contenido MD renderizado en una sola "página" con `min_read_seconds`; misma cuenta regresiva en el botón de completar.
- Teclado: `←`/`→` cambian página (respetando el bloqueo), `F` pantalla completa.

### 2.5 Player de examen — ítem `exam`

**Pantalla de inicio (siempre antes de consumir un intento):**

```
│  Examen final — Seguridad Industrial                                     │
│  <FileQuestion> 10 preguntas · ⏱ 20 minutos · Calificación mínima: 80%   │
│  Intentos: 1 de 3 usados · Se toma tu MEJOR calificación                 │
│  Cierra: 15 ago 2026, 11:59 pm                                           │
│                                                                          │
│  ⓘ Al comenzar, el tiempo corre aunque cierres la ventana.               │
│                                [ Comenzar intento ] (verde)              │
│  Intentos anteriores: #1 — 65% — 10 ago                                  │
```

**Durante el intento** (una pregunta por página por defecto; `shuffle` transparente para el alumno):

```
│  Pregunta 3 de 10                              ⏱ 14:32 restantes         │
│  ▓▓▓░░░░░░░  ← respondidas, clicable para saltar                         │
│                                                                          │
│  ¿Cuál es el tipo de extintor adecuado para fuego eléctrico?   (2 pts)   │
│   (o) Agua a presión                                                     │
│   (●) CO₂                                                                │
│   (o) Espuma                                                             │
│                                                                          │
│  [← Anterior]        ○ ○ ● ○ ○ ○ ○ ○ ○ ○         [Siguiente →]           │
│                      └ navegador de preguntas (respondida = relleno)     │
```

- **Timer**: fijo arriba a la derecha, siempre visible. A <5 min pasa a ámbar; a <1 min a rojo con pulso suave (sin sonido). El servidor manda la hora de fin; el cliente solo cuenta hacia ella (reloj del servidor es la verdad). Autoenvío al llegar a 0 con toast "Se acabó el tiempo — tu intento se envió automáticamente".
- Autosave de cada respuesta al seleccionarla (indicador "Guardado" 12px con `Check`, discreto). Cerrar la pestaña no pierde nada; reabrir retoma el intento en curso.
- Tipos de pregunta: radios (single/TF), checkboxes (multiple, con nota "elige todas las que apliquen"), input de texto (short_text), dos columnas con selects (matching — sin drag en v1: accesible y suficiente), textarea (open_text, con contador).
- **Confirmación de envío** (modal): "Vas a enviar tu examen. **Respondiste 9 de 10 preguntas** — te falta la 7 [ir a la pregunta]. Esta acción no se puede deshacer. [Cancelar] [Enviar examen]".

**Resultados según `show_results_mode`:**
- `immediately`: pantalla con anillo grande de calificación (verde ≥ pass, rojo <), desglose por pregunta con `Check`/`X` y respuesta correcta, feedback del maestro si existe. CTA "Continuar con el curso".
- `after_close`: "Tu examen fue enviado. Los resultados estarán disponibles el 16 ago." + `CalendarClock`. El ítem queda en estado "Enviado" (badge cyan) en el árbol.
- `manual` / con `open_text` pendiente: "Tu examen fue enviado. Tu instructor lo revisará — te avisaremos aquí" (campana). Si la parte automática existe, **no** se muestra parcial (evita confusión de "subió mi nota").

### 2.6 Entrega de tarea — ítem `assignment`

```
│  Tarea: Plan de evacuación de tu área          Entrega: 20 ago · 100 pts │
│  ┌ Instrucciones (MD renderizado) ─────────────────────────────┐         │
│  └──────────────────────────────────────────────────────────────┘        │
│  Tu entrega                                                              │
│  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐                                  │
│    <Upload>  Arrastra tu archivo aquí                                    │
│    o [ Elegir archivo ]  · PDF o DOCX · máx 20 MB                        │
│  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘                                  │
│  Comentario (opcional) [___________________________]                     │
│                                      [ Entregar tarea ] (verde)          │
```

Estados posteriores en la misma pantalla:
- **Entregada**: card con `FileText` nombre del archivo, fecha, badge cyan "Entregada — en revisión". Si `allow_resubmission`: botón secundario "Reemplazar entrega" con confirmación.
- **Calificada**: score grande "85 / 100", feedback del maestro en card, badge verde "Calificada". Si fue "Devuelta" (`returned`): badge ámbar + feedback + zona de re-entrega activa.
- Entrega tras `due_at` (si se permite): badge rojo "Entregada con retraso" visible para ambos.

### 2.7 Dashboard maestro — `/teach/dashboard`

```
│  Buen día, Prof. Martínez                                                │
│  ┌ Estudiantes ┐ ┌ Cursos     ┐ ┌ Por calificar┐ ┌ Certificados ┐        │
│  │ 1,240 activos│ │ 8 publicados│ │ ▓ 12 ⚠      │ │ 96 emitidos  │        │
│  └─────────────┘ └────────────┘ └─────────────┘ └──────────────┘         │
│                                                                          │
│  Por calificar (12)                        [Ver toda la cola →]          │
│  <FileQuestion> Examen final · Ventas · 5 intentos con texto abierto     │
│  <Upload> Plan de evacuación · Seguridad · 7 entregas       hace 2 h     │
│                                                                          │
│  Mis cursos                                  [ + Nuevo curso ]           │
│  ┌ Seguridad Industrial · Publicado · 320 inscritos · 61% prom ─┐        │
│  ┌ Ventas B2B · Publicado · 180 inscritos · 84% prom ───────────┐        │
│  ┌ Inducción 2026 · Borrador · — ────────────── [Continuar edición]      │
│                                                                          │
│  Actividad reciente                                                      │
│  • Laura P. completó "Seguridad Industrial"              hace 10 min     │
│  • 3 estudiantes entregaron "Plan de evacuación"         hace 1 h        │
```

- 4 KPIs en cards blancas; "Por calificar" con número en ámbar si >0 y clicable → `/teach/grading`.
- La cola resumida muestra máx. 3 grupos; cada fila navega directo al primer elemento por calificar de ese grupo (1 clic del dashboard a calificar).
- Actividad reciente: últimas 8, solo eventos accionables o de cierre (completó curso, entregó, reprobó examen final).

### 2.8 Editor de contenido del curso — `/teach/courses/[id]/content`

Tab "Contenido" del curso. Layout de dos paneles:

```
│ Seguridad Industrial  [Borrador ▾]     Tabs: ▓Contenido Estudiantes ...  │
│ ┌─ ÁRBOL (400px) ──────────────────┬─ DETALLE DEL ÍTEM SELECCIONADO ──┐  │
│ │ [+ Agregar ▾]                    │  Manejo de extintores            │  │
│ │                                  │  Tipo: Documento (PPTX)          │  │
│ │ ⠿ ▾ <Folder> Módulo 1            │  ┌──────────────────────────┐    │  │
│ │ ⠿   <FileText> Bienvenida      ✓ │  │ <Loader2> Convirtiendo   │    │  │
│ │ ⠿   <FileText> Normativa       ✓ │  │ PPT a visor… (~1 min)    │    │  │
│ │ ⠿ ▾ <Folder> Módulo 2            │  └──────────────────────────┘    │  │
│ │ ⠿   <FileText> Riesgos         ✓ │  Título [________________]       │  │
│ │ ⠿  ▓<FileText> Extintores      ⟳ │  Seg. mínimos/página [3]         │  │
│ │ ⠿   <Play> Evacuación (video)  ✓ │  [x] Requerido para completar    │  │
│ │ ⠿ ▾ <Folder> Módulo 3            │  Secuencia: (o) Heredar          │  │
│ │ ⠿   <FileQuestion> Examen final✓ │             (o) Obligatoria      │  │
│ │                                  │             (o) Libre            │  │
│ │                                  │  [Guardar]  [Vista previa]       │  │
│ └──────────────────────────────────┴──────────────────────────────────┘  │
```

**Drag & drop (dnd-kit):**
- Handle `GripVertical` (⠿) siempre visible al inicio de cada fila — no drag de fila completa (evita drags accidentales).
- Al arrastrar: la fila se vuelve semi-transparente y una **línea de inserción cyan 2px** marca el destino entre hermanos; arrastrar **sobre una carpeta** la resalta con fondo cyan 10% y sangría fantasma = "soltar dentro".
- Anidación máx. 2 niveles: si el drop violaría la regla, la línea de inserción se pinta roja y el drop rebota a su origen con toast "Máximo dos niveles de carpetas".
- Reordenar es optimista (UI inmediata, rollback con toast de error si la transacción falla).
- **Alternativa sin drag (WCAG 2.5.7 y usuarios de teclado)**: menú `⋯` por fila con "Subir / Bajar / Mover a carpeta…".

**Botón "+ Agregar"** (dropdown): Carpeta `Folder` · Documento (PPT/PDF) `FileText` · Video por enlace `Play` · Lectura `AlignLeft` · Examen `FileQuestion` · Tarea `Upload`. Se inserta al final del nivel seleccionado y abre su panel de detalle con el título en edición.

**Estados de procesamiento de archivos** (badge junto al título en el árbol + card en el detalle):
- `pending`: `Clock` gris "En cola…"
- `processing`: `Loader2` girando cyan "Convirtiendo…" (polling; el maestro puede navegar, no bloquea)
- `ready`: `Check` verde, aparece miniatura de página 1 + "12 páginas"
- `error`: `TriangleAlert` rojo + mensaje en lenguaje llano ("No pudimos convertir este PPT. Revisa que no esté protegido con contraseña.") + botón "[Reintentar]"
- Un curso **no puede publicarse** con ítems en `pending/processing/error`: el botón "Publicar" se deshabilita con tooltip que lista los ítems problema.

**Video por enlace**: el detalle pide URL, valida y muestra preview embebido + duración detectada (editable), toggle "Permitir velocidad aumentada".

### 2.9 Editor de examen — `/teach/courses/[id]/items/[itemId]/edit`

```
│ ← Contenido / Examen final                                               │
│ ┌ Ajustes del examen (card colapsable) ─────────────────────────────┐    │
│ │ Instrucciones [MD]  · Abre [fecha] Cierra [fecha]                 │    │
│ │ Intentos máx [3] · Se toma: (●)Mejor (o)Último (o)Promedio        │    │
│ │ Tiempo límite [20] min · Calif. mínima [80]%                      │    │
│ │ [x] Barajar preguntas · Resultados: (●)Al enviar (o)Al cerrar     │    │
│ │                                     (o)Cuando yo decida           │    │
│ └───────────────────────────────────────────────────────────────────┘    │
│ Preguntas (10 · 24 pts)                      [ + Nueva pregunta ▾ ]      │
│ ⠿ 1. Opción única · "¿Cuál es el tipo de extintor…?" · 2 pts  [✎][⧉][🗑] │
│ ⠿ 2. Verdadero/Falso · "El CO₂ conduce electricidad" · 1 pt   [✎][⧉][🗑] │
│ ⠿ 3. Texto abierto · "Describe el procedimiento…" · 5 pts ⚠M  [✎][⧉][🗑] │
```

- "+ Nueva pregunta" dropdown con los 6 tipos en español llano: Opción única, Opción múltiple, Verdadero/Falso, Respuesta corta, Relacionar columnas, Texto abierto.
- Cada pregunta se edita **inline expandida** (no modal — se pierde contexto con 30 preguntas): prompt MD, imagen opcional, puntos, y editor de opciones según tipo (opción única: radios para marcar la correcta; múltiple: checks + toggle "puntaje parcial"; respuesta corta: chips de variantes aceptadas; matching: pares de inputs).
- Badge `⚠M` ámbar en preguntas de texto abierto: "requiere calificación manual" — el maestro ve de un vistazo cuánta cola se está creando.
- Reordenar con handle ⠿ o menú `⋯`. Duplicar (`Copy` ⧉) es clave: la mayoría de preguntas nuevas son variantes.
- Validación al guardar: pregunta sin respuesta correcta marcada → borde rojo + mensaje junto a la pregunta, no solo toast.
- Botón "Vista previa como estudiante" (abre el runner en modo sandbox, sin registrar intento).

### 2.10 Constructor de reglas de aprobación — `/teach/courses/[id]/rules`

Visual, nunca JSON. Default AND plano presentado como lista humana:

```
│ Reglas de aprobación                                                     │
│ Un estudiante aprueba este curso cuando cumple TODAS estas condiciones:  │
│                                                                          │
│ ┌ <Eye> Ver todo el contenido requerido      al [100]%      [🗑] ┐       │
│ ┌ <FileQuestion> Promedio de exámenes        mínimo [80]%   [🗑] ┐       │
│ │   Aplica a: (●) Todos los exámenes (o) Elegir… [☑Ex.1 ☑Final]  │       │
│ ┌ <Upload> Promedio de tareas calificadas    mínimo [70]%   [🗑] ┐       │
│                                                                          │
│ [ + Agregar condición ▾ ]     [ ⚙ Modo avanzado (Y/O anidado) ]          │
│                                                                          │
│ ┌ Vista previa ─────────────────────────────────────────────────┐        │
│ │ Con las reglas actuales, hoy aprobarían 143 de 320 inscritos. │        │
│ └───────────────────────────────────────────────────────────────┘        │
│                                              [ Guardar reglas ]          │
```

- "+ Agregar condición": Ver todo el contenido · Promedio de exámenes · Un examen específico ≥ X · Promedio de tareas · Todos los ítems completados · Mi aprobación manual.
- **Modo avanzado** (Fase 4): grupos con conector Y/O como cards anidadas con sangría y borde de color por grupo (cyan = Y, ámbar = O), máx. 2 niveles de anidación.
- La **vista previa de impacto** ("hoy aprobarían N de M") convierte una configuración abstracta en consecuencia concreta antes de guardar.
- Al guardar con matriculados: aviso "Las reglas se evaluarán de nuevo para todos. Nadie pierde una aprobación ya otorgada."

### 2.11 Matriz de progreso alumnos × ítems — `/teach/reports`

```
│ Reportes   Curso: [Seguridad Industrial ▾]   Buscar alumno [_______]     │
│ Filtro: [Todos ▾ | En riesgo | Completados]        [ ⬇ Exportar CSV ]    │
│                                                                          │
│              │Bienv│Norm│Riesg│Extin│Evac│Ex.F│ Curso │                  │
│ Laura Pérez  │  ●  │ ●  │  ●  │  ◐  │ 🔒 │ 🔒 │  62%  │                  │
│ Juan Gómez   │  ●  │ ●  │  ●  │  ●  │ ●  │ ●✓ │ 100%✓ │                  │
│ Ana Torres   │  ●  │ ◐  │  ○  │ 🔒  │ 🔒 │ 🔒 │  18%⚠ │                  │
│ …paginado 50/página…                                                     │
```

- **Semáforo**: `●` verde = completado, `◐` ámbar = en progreso, `○` gris claro = disponible sin empezar, `Lock` = bloqueado, rojo = vencido. Exámenes muestran además ✓/✗ de aprobado (Completado ≠ Aprobado, siempre).
- Columnas = ítems requeridos en orden DFS (carpetas como grupos de encabezado). Con muchos ítems: scroll horizontal con **primera columna (alumno) y última (curso) fijas** (sticky).
- **Drill-down**: clic en fila → panel lateral (Sheet de shadcn) del alumno: por ítem, % visto, tiempo invertido, intentos con puntajes, botones "Ver entrega"/"Ver intento". Clic en una celda abre el mismo panel anclado a ese ítem. Nunca se sale de la página.
- Paginación + búsqueda server-side desde el día uno (1k–5k alumnos). Filtro "En riesgo" = <50% con fecha límite ≤ 7 días, o vencidos.
- **Exportar CSV**: exporta el filtro actual, no todo; botón con spinner y toast al descargar.

### 2.12 Cola de calificación — `/teach/grading` (global) y tab por curso

```
│ Por calificar (12)   [Todos los cursos ▾]  [Exámenes | Tareas | Todo]    │
│ ┌ LISTA (360px) ────────────┬─ PANEL DE CALIFICACIÓN ────────────────┐   │
│ │ ▓ Laura P. · Examen final │ Laura Pérez — Examen final · Intento 2 │   │
│ │   2 preguntas · hace 2 h  │ Autocalificado: 14/19 pts              │   │
│ │  Juan G. · Examen final   │ ─ Pregunta 8 (texto abierto, 5 pts) ─  │   │
│ │   2 preguntas · hace 3 h  │ "Describe el procedimiento…"           │   │
│ │  Ana T. · Tarea: Plan…    │ ┌ Respuesta de Laura ──────────────┐   │   │
│ │   hace 1 día ⚠            │ └──────────────────────────────────┘   │   │
│ │                           │ Puntos [4]/5  Feedback [___________]   │   │
│ │                           │ [ Guardar y siguiente → ] (verde)      │   │
│ └───────────────────────────┴────────────────────────────────────────┘   │
```

- Patrón bandeja+detalle (como email): la lista ordena por antigüedad (lo más viejo arriba; ⚠ ámbar si >24 h).
- **"Guardar y siguiente"** es el CTA: califica, publica `final_score` si ya no queda nada manual, dispara el motor de reglas y **avanza automáticamente al siguiente**. Calificar 30 entregas debe sentirse como una racha, no 30 navegaciones.
- Tareas: preview del archivo embebido si es PDF (mismo visor), descarga si no; score + feedback + acciones "Calificar" o "Devolver para corrección" (estado `returned`).
- Solo se muestran las preguntas que requieren revisión manual (las automáticas, colapsadas en un resumen expandible).

### 2.13 CRUD de estudiantes + import CSV — `/teach/students`

```
│ Estudiantes (1,240)   Buscar [________]  [⬆ Importar CSV] [+ Nuevo]      │
│ Nombre ↕        Email              Cursos  Último acceso   Estado   ⋯    │
│ Laura Pérez     laura@empresa.com    3     hoy, 10:42      Activo   ⋯    │
│ …paginado, búsqueda server-side…                                         │
```

- Menú `⋯` por fila: Ver progreso (→ drill-down de reportes) · Matricular en curso… · Restablecer contraseña (genera temporal, se muestra una sola vez con botón copiar) · Desactivar (soft, con confirmación).
- **"+ Nuevo"**: modal simple — nombre, email, contraseña inicial (autogenerada con `RefreshCw` para regenerar), checklist de cursos a matricular. Al crear: toast con "Copiar credenciales".
- **Importar CSV — asistente de 3 pasos en modal ancho**:
  1. **Subir**: dropzone + link "Descargar plantilla CSV" (nombre, email, contraseña).
  2. **Revisar**: tabla de preview con validación por fila — verde OK, ámbar "email ya existe (se omitirá / matricular igual)", rojo "email inválido" con el motivo. Contador "142 se crearán, 3 se omitirán, 1 con error". Se puede continuar con errores (solo se importan las válidas).
  3. **Resultado**: "142 estudiantes creados" + botón "Descargar reporte" + opción "Matricular a todos en… [curso ▾]".

### 2.14 Editor de plantilla de certificado — `/teach/templates/[id]`

```
│ ← Plantillas / Diploma corporativo 2026                    [Guardar]     │
│ ┌ CAMPOS (280px) ─────────────┬─ LIENZO (preview a escala) ──────────┐   │
│ │ Fondo: diploma.pdf [Cambiar]│ ┌──────────────────────────────────┐ │   │
│ │ Tamaño: (●)Carta (o)A4      │ │        [fondo subido]            │ │   │
│ │ Orientación: (●)Horizontal  │ │   ┌╌ Nombre del estudiante ╌┐    │ │   │
│ │                             │ │   ┌╌ Título del curso ╌┐         │ │   │
│ │ [+ Agregar campo ▾]         │ │        ┌╌ Fecha ╌┐   ┌╌QR╌┐      │ │   │
│ │  ▓ Nombre del estudiante    │ │              ┌╌ Folio ╌┐         │ │   │
│ │    Fuente [Poppins ▾] [28]  │ └──────────────────────────────────┘ │   │
│ │    Color [■] Alinear [≡ ▾]  │ Probar con: [María Fernanda de los   │   │
│ │  · Título del curso         │  Ángeles Gutiérrez Bustamante ▾]     │   │
│ │  · Fecha · Folio · QR       │                                      │   │
│ └─────────────────────────────┴──────────────────────────────────────┘   │
```

- Campos disponibles: Nombre del estudiante, Título del curso, Fecha, Calificación, Folio, Código QR, Texto libre.
- Cada campo es una **caja arrastrable en el lienzo** (drag con snap a guías centrales; también editable por X/Y numéricos — precisión y accesibilidad). Seleccionado = borde cyan con handles; QR solo se redimensiona proporcional.
- **Selector "Probar con"**: alterna nombres de prueba corto / medio / larguísimo — si un campo desborda se pinta el borde en ámbar con tooltip "Este nombre no cabe: reduce la fuente o amplía la caja".
- Botón "Generar PDF de prueba" (usa el pipeline real de pdf-lib — lo que ves es lo que se emite).
- Aviso permanente discreto: "Los cambios no afectan certificados ya emitidos."

### 2.15 Página pública de verificación — `/verify/[folio]`

Sin sesión, sin shell de app, misma estética; se ve bien en el móvil que escaneó el QR:

```
│                    [logo empresa]                    │
│   ┌──────────────────────────────────────────────┐   │
│   │       <BadgeCheck verde 48px>                │   │
│   │        Certificado válido                    │   │
│   │                                              │   │
│   │  Laura Pérez Domínguez                       │   │
│   │  Seguridad Industrial                        │   │
│   │  Emitido: 12 de marzo de 2026                │   │
│   │  Folio: CERT-2026-000123-K7QX                │   │
│   │  Instructor: Prof. R. Martínez               │   │
│   └──────────────────────────────────────────────┘   │
│   Verificado contra los registros de [Empresa].      │
```

- **Válido**: card borde verde, `BadgeCheck`. **Revocado**: borde rojo, `ShieldX`, "Certificado revocado" + fecha. **No encontrado**: `SearchX` gris, "No existe un certificado con este folio" + input para reintentar.
- No muestra calificación ni email (dato mínimo necesario). No hay link de descarga del PDF (la descarga es del alumno autenticado).

---

## 3. Sistema de estados y feedback

### 3.1 Estados de ítem (léxico visual único en toda la app)

| Estado | Icono | Tratamiento | Interacción |
|---|---|---|---|
| `locked` | `Lock` gris `#94A3B8` | Texto gris, fondo neutro, cursor `not-allowed` | Tooltip (hover **y** focus): "Completa «X» primero" |
| `available` | `Circle` gris contorno | Texto normal | Navegable |
| `in_progress` | `CircleDot` cyan | Texto normal + % pequeño | Navegable; el actual: fondo cyan 10% + borde izq. 3px |
| `completed` | `CircleCheck` verde relleno | Texto normal | Navegable (repasar es libre) |
| Enviado/en revisión | `Clock` cyan | Badge cyan "En revisión" | Navegable a su pantalla de estado |
| Vencido | `TriangleAlert` rojo | Texto + fecha en rojo | Según configuración |

La misma semántica de color aplica en matriz, dashboards y badges. **El color nunca es el único indicador**: siempre icono + (donde cabe) texto.

### 3.2 Carga (skeletons)

- **Regla**: skeleton con la forma del contenido esperado, nunca spinner de página completa. Pulso suave 1.5s (estático con reduced-motion).
- Spinner (`Loader2`) solo para acciones puntuales dentro de botones ("Guardando…", botón deshabilitado mientras).
- Procesos largos (conversión PPT, generación de certificado): estado con texto de expectativa ("~1 min") y polling — nunca bloquear la navegación.
- Navegación entre páginas del visor PDF: la página anterior permanece visible con overlay sutil hasta que renderiza la nueva (sin flashes blancos).

### 3.3 Estados vacíos (siempre: icono + frase + CTA)

| Contexto | Mensaje | CTA |
|---|---|---|
| Estudiante sin cursos | `BookOpen` "Aún no tienes cursos asignados. Tu instructor te matriculará pronto." | — |
| Maestro sin cursos | `Sparkles` "Crea tu primer curso" | [+ Nuevo curso] |
| Curso sin contenido | `FolderPlus` "Empieza agregando una carpeta o una lección" | [+ Agregar] |
| Cola de calificación vacía | `CircleCheck` verde "Todo calificado. Nada pendiente." | — |
| Sin certificados (alumno) | `Award` "Tus certificados aparecerán aquí al aprobar un curso" | [Ver mis cursos] |
| Búsqueda sin resultados | `SearchX` "Sin resultados para «x»" | [Limpiar búsqueda] |

### 3.4 Toasts y confirmaciones

- Toasts (sonner) **abajo a la derecha**, 4s, apilables máx. 3: éxito (borde verde + `CircleCheck`), error (borde rojo + `TriangleAlert`, persiste hasta cerrar, con "Reintentar" cuando aplica), info (cyan).
- Errores en lenguaje llano, jamás códigos: "No se pudo guardar. Revisa tu conexión con el servidor."
- Confirmación modal **solo** para acciones destructivas o irreversibles: enviar examen, borrar ítem con progreso de alumnos, desactivar usuario, revocar certificado. Borrados suaves usan Deshacer en el toast cuando sea posible.

### 3.5 Badges de notificación

- Campana: dot + número, verde `#16A34A`, texto blanco; anima una sola vez al incrementarse (scale, 200ms).
- Sidebar "Por calificar": mismo estilo, en ámbar (es deuda, no premio).
- Al leerse/atenderse, los contadores se actualizan optimistamente.

---

## 4. Flujos críticos paso a paso

### (a) Estudiante completa un curso y descarga su certificado

1. Login → dashboard. Clic en **"Continuar →"** del hero → aterriza directo en el ítem en progreso, página guardada. *(2 clics desde cero.)*
2. Lee las páginas restantes; cada "Siguiente" se habilita tras el mínimo por página. Última página acreditada → toast "Lección completada", check verde en el árbol, el siguiente ítem pierde el candado con transición suave.
3. Llega al **Examen final** (desbloqueado). Pantalla de inicio → "Comenzar intento" → responde con timer visible → "Enviar examen" → modal de confirmación → confirma.
4. `immediately` y sin preguntas abiertas → resultados al instante: 86% ≥ 80% → aprobado. El motor de reglas evalúa → **curso aprobado**: `completed_at`, job `generate_certificate`, notificaciones.
5. Banner verde: "¡Aprobaste! Tu certificado se está generando…". La campana recibe `certificate_issued` segundos después.
6. Clic en la notificación → **"Descargar PDF"**. El QR apunta a `/verify/CERT-2026-…`.
7. Caso alterno — no aprueba: resultados en rojo + desglose: "Te falta: Examen final (65% < 80%). Te quedan 2 intentos." + botón "Reintentar examen". Nunca un callejón sin salida.

### (b) Maestro crea un curso completo desde cero

1. Dashboard → **"+ Nuevo curso"** → modal mínimo (título, descripción, portada) → aterriza en tab **Contenido** vacío. El curso nace en **Borrador**.
2. "+ Agregar ▾" → Carpeta "Módulo 1" → Documento → sube `normativa.pptx` → `Loader2` "Convirtiendo…"; el maestro **sigue trabajando** (lectura, video por enlace con preview y duración autocompletadas).
3. Agrega **Examen**: configura 20 min / 3 intentos / mejor / 80%, crea 10 preguntas (duplicando variantes), 2 de texto abierto (badges `⚠M`). "Vista previa como estudiante".
4. Reordena con drag: la línea cyan confirma el destino.
5. Tab **Reglas**: default "Ver todo el contenido al 100%"; agrega "Promedio de exámenes ≥ 80%". Vista previa de impacto. Guardar.
6. (Opcional) Plantilla de certificado: fondo + campos + prueba con nombre largo + asignar al curso en **Ajustes**.
7. Tab **Estudiantes** → "Matricular" o "Importar CSV" (paso final: "matricular a todos en este curso").
8. PPT ya `ready` → **"Publicar"** → confirmación con checklist automático → Publicado. Los alumnos ven el curso en su dashboard.

### (c) Maestro califica pendientes

1. Sidebar muestra **"Por calificar (12)"** en ámbar (o llega por la campana).
2. `/teach/grading`: bandeja por antigüedad; el primer elemento ya está abierto en el panel derecho.
3. Examen: resumen autocalificado colapsado + preguntas abiertas. Puntos + feedback → **"Guardar y siguiente →"**: publica `final_score`, dispara el motor de reglas — si aprueba, certificado y notificaciones — y **avanza automáticamente**.
4. Tarea: preview del PDF embebido, score + feedback, o **"Devolver para corrección"**.
5. Racha hasta vaciar: "Todo calificado. Nada pendiente."
6. Caso alterno — recalifica a la baja con certificado emitido: modal "El sistema no lo revocará automáticamente. [Solo recalificar] [Recalificar y revisar certificado]".

---

## 5. Accesibilidad y responsive

### 5.1 Accesibilidad (WCAG 2.1 AA como piso)

- **Contraste**: texto ≥ 4.5:1 (`#164E63` sobre blanco; CTA `#16A34A`); componentes UI ≥ 3:1. El cyan `#22D3EE` **nunca** lleva texto encima.
- **Focus visible siempre**: `outline: 2px solid #0891B2; outline-offset: 2px` global. `scroll-margin-top: 72px` en destinos de foco (header fijo).
- **Teclado completo**: examen 100% navegable con teclado; drag & drop con alternativa por menú/inputs numéricos (WCAG 2.5.7); modales con focus trap y Esc.
- **Tooltips de candado accesibles**: por focus además de hover, con `aria-describedby`; el ítem bloqueado es focusable aunque no navegable.
- **Semántica**: `nav`/`main`/`aside`; árbol como `role="tree"`; matriz con `th scope`; iconos decorativos `aria-hidden`, iconos-botón con `aria-label` en español.
- **Timer del examen**: avisos por `aria-live="polite"` a los 5 min y 1 min. El color nunca es el único aviso.
- **`prefers-reduced-motion`**: desactiva pulsos, shakes y animaciones de checkmark; las transiciones de opacidad quedan.
- **Formularios**: label visible siempre (no placeholder-como-label), errores junto al campo + resumen `aria-live`.

### 5.2 Responsive (desktop-first en uso, mobile-capaz desde 375px)

Breakpoints: 1440 / 1024 / 768 / 375.

- **≥1024 (uso principal)**: todo como se especificó. Sidebar 240px fijo.
- **768–1023 (tablet)**: sidebar colapsa a 64px solo-iconos; paneles duales pasan a lista → detalle apilados con "← Volver"; matriz con scroll horizontal y columnas sticky.
- **<768 (móvil, 375px mínimo)**: sidebar como drawer (`Menu` en header). El **estudiante es la prioridad móvil**: Focus Mode con árbol en drawer (`ListTree`), barra Anterior/Siguiente fija abajo (zona del pulgar), visor fit-width, examen ya es una pregunta por pantalla. Los editores de maestro muestran aviso amable "Este editor funciona mejor en pantalla grande" sin bloquear.
- **Touch targets ≥ 44×44px**; separación mínima 8px.
- Sin scroll horizontal salvo tablas de datos, que lo anuncian con sombra de borde. Inputs con `font-size: 16px` mínimo (evita zoom de iOS).

### 5.3 Rendimiento percibido

- Interacciones <100ms percibidos: navegación de árbol y tabs sin round-trip; mutaciones optimistas en checks, reorden y notificaciones.
- Transiciones solo con CSS (`transform`/`opacity`); nunca animar `width/height` en listas largas.
- Heartbeat y autosave invisibles: sin spinners por tráfico de fondo; solo el "Guardado ✓" discreto del examen.

---

## 6. Checklist de cierre por pantalla (para desarrollo)

- [ ] ¿Se llega en ≤2 clics desde el dashboard del rol?
- [ ] ¿Todo estado (vacío / cargando / error / éxito) está diseñado?
- [ ] ¿Lo bloqueado se ve con candado + tooltip con la razón?
- [ ] ¿El CTA primario es único, verde `#16A34A` y ≥44px?
- [ ] ¿Funciona con teclado y el focus es visible sin quedar tapado?
- [ ] ¿Copy en español llano, sin jerga (nada de "status: pending", "parse error", "enrollment")?
- [ ] ¿Se ve bien a 375px o degrada con aviso amable (editores de maestro)?
- [ ] ¿Iconos solo de Lucide, coherentes con el léxico de §3.1?

> Nota de implementación: las fuentes Poppins y Open Sans deben servirse **localmente** con `next/font/local` o los paquetes `@fontsource` (la plataforma corre en LAN sin internet garantizado — nunca usar el CDN de Google Fonts).
