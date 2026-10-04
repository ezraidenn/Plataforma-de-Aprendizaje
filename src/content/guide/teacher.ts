import type { RoleGuide } from "./types";

export const TEACHER_GUIDE: RoleGuide = {
  role: "teacher",
  label: "Maestro",
  tagline: "De cero a un curso publicado, calificado y certificado.",
  sections: [
    {
      id: "inicio",
      title: "Tu panel de inicio",
      section: "home",
      intro:
        "Al entrar verás un resumen: cursos activos, entregas por calificar y actividad reciente. El menú de la izquierda cambia de color según la sección: así siempre sabes dónde estás.",
      steps: [
        {
          title: "Ubícate por colores",
          text: "Cada sección tiene su color en el menú y en la barra superior: índigo Inicio, azul Cursos, ámbar Por calificar, verde Estudiantes y Grupos, morado Reportes, rojo Certificados, naranja Vencimientos. El número junto a «Por calificar» son las entregas y exámenes que esperan tu revisión; el de «Vencimientos», los certificados vencidos por atender.",
          href: "/teach/dashboard",
          hrefLabel: "Ir a Inicio",
        },
        {
          title: "Campana de notificaciones",
          text: "Arriba a la derecha, dentro de la barra de color, la campana muestra avisos: nuevas entregas, alumnos que terminaron un curso, certificados emitidos. Al abrirla puedes marcarlas como leídas, borrar una con la ✕ o dejarla en limpio con «Borrar todas»: así lo que aparezca después será realmente nuevo.",
          ui: ["Marcar como leídas", "Borrar todas"],
        },
        {
          title: "Primeros pasos",
          text: "En el Inicio, una banda te lleva por los cinco primeros pasos (curso, lección, estudiantes, matrícula y publicación, diploma) y se marca sola con lo que ya hiciste. «Ver todos» muestra la lista; «Ocultar» la esconde y puedes recuperarla con el enlace que queda en su lugar. Desaparece al completarla.",
          href: "/teach/dashboard",
          hrefLabel: "Inicio",
          ui: ["Primeros pasos", "Ver todos", "Ocultar"],
        },
      ],
    },
    {
      id: "curso",
      title: "Crear un curso",
      section: "courses",
      intro: "Un curso es una carpeta con contenidos en orden. Primero lo creas, luego lo llenas y al final lo publicas.",
      steps: [
        {
          title: "Nuevo curso",
          text: "En «Mis cursos» pulsa «Nuevo curso». Escribe el título y una descripción breve. El buscador de arriba filtra en vivo por título o descripción (sin importar acentos).",
          href: "/teach/courses",
          hrefLabel: "Mis cursos",
          ui: ["Nuevo curso"],
        },
        {
          title: "Imagen y ajustes del curso",
          text: "En la pestaña «Ajustes» puedes subir una imagen del curso (con encuadre: arrastra, acerca, centra), definir si es secuencial (cada lección se desbloquea al terminar la anterior), asignar la plantilla de certificado y archivar el curso. Un curso sin publicar y sin certificados emitidos también se puede «Eliminar definitivamente» (pide dos confirmaciones).",
        },
        {
          title: "Publicar",
          text: "Mientras está en borrador, los alumnos no lo ven. Cuando el contenido esté listo, abre el menú de estado en el encabezado del curso y pulsa «Publicar». Si el curso no tiene ninguna lección o hay documentos sin procesar, la plataforma te lo indica antes.",
          scene: "teacher-curso-3",
          ui: ["Borrador", "Publicado", "Archivado"],
        },
      ],
    },
    {
      id: "contenido",
      title: "Agregar contenido",
      section: "courses",
      intro:
        "En «Contenido» armas el árbol del curso: carpetas (máximo dos niveles) y lecciones. Arrastra para reordenar. Cada tipo tiene su color e icono. Al seleccionar un elemento, su panel de detalle aparece a la derecha.",
      steps: [
        {
          title: "El árbol y el botón «Agregar»",
          text: "Con el botón «+ Agregar» eliges qué crear: carpeta o alguno de los 7 tipos de lección; siempre se agrega al final del curso (primer nivel). Para crear algo dentro de una carpeta usa su menú ⋮ → «Agregar dentro», o arrastra la lección y suéltala sobre la carpeta.",
          scene: "teacher-contenido-1",
          tip: "Atajos con un elemento seleccionado: flechas para moverte, Alt+↑/↓ para reordenar, Ctrl+C / Ctrl+V para copiar y pegar (también en otro curso), Ctrl+X para mover, Ctrl+D para duplicar, Supr para eliminar (con unos segundos para deshacer) y Ctrl+Z para deshacer. El botón del teclado junto a «Agregar» los muestra todos.",
        },
        {
          title: "Documento (PDF o PowerPoint)",
          text: "Sube el archivo en el panel de detalle; los PPT se convierten a PDF automáticamente (verás «Procesando» y luego «Listo»). Define los segundos mínimos por página: el alumno no puede saltarse hojas.",
          scene: "teacher-contenido-2",
          kind: "document",
        },
        {
          title: "Lectura (editor de texto)",
          text: "Escribe directamente con el editor: títulos, colores, resaltado, tablas, listas, imágenes. Puedes pegar desde Word o Excel y se conserva el formato (excepto las fuentes, que se normalizan). Define los segundos mínimos de lectura.",
          kind: "text",
        },
        {
          title: "Video (YouTube)",
          text: "Pega el enlace del video. La plataforma registra los tramos realmente vistos: adelantar no cuenta. Verás una vista previa para confirmar que el enlace es correcto.",
          scene: "teacher-contenido-4",
          kind: "video",
        },
        {
          title: "Examen",
          text: "Crea preguntas de opción múltiple, verdadero/falso, relacionar, ordenar pasos, clasificar en grupos (tarjetas de texto o imagen), completar el texto (eliges si el alumno escribe, toma palabras de un banco o elige de una lista en cada hueco), abiertas (estas últimas las calificas tú) y sobre una foto: arrastrar a la imagen y señalar en la imagen. En las de foto acomodas todo como en un editor de dibujo: estiras un ícono desde su esquina, lo giras con la bolita, las guías rojas y el imán lo alinean con los demás, Ctrl+Z deshace, el zoom acerca para los detalles y puedes recortar o girar la foto sin perder lo acomodado. Configura intentos, tiempo límite, calificación mínima, si se muestran respuestas y si se toman preguntas al azar de un banco. Si ya tienes las preguntas escritas, «Importar con IA» lee hasta 5 archivos a la vez (Word, Excel, PDF, PowerPoint, CSV, fotos o capturas, incluso PDF escaneados) y arma cada una con su tipo: antes de crearlas las revisas, corriges lo que falte y las pruebas como alumno. También puedes importar por CSV. «Ver como alumno» recorre el examen tal como se verá, sin guardar ni calificar nada. En «Mostrar resultados» decides cuándo ve el alumno su calificación: al enviar, al cerrar el examen o cuando pulses «Publicar resultados»; al publicarlos le llega un aviso.",
          kind: "exam",
          ui: ["Importar con IA", "Ver como alumno", "Importar CSV"],
          tip: "«Importar con IA» aparece cuando el administrador guarda la clave de OpenAI en Configuración. La IA solo transcribe lo que está en tu archivo: no inventa preguntas ni respuestas.",
        },
        {
          title: "Tarea (estilo Teams)",
          text: "Escribe las instrucciones con el editor, adjunta material de apoyo (PDF de instrucciones, plantillas) y define fecha límite, puntos, si acepta entregas tardías y reentregas. El alumno responde con texto y/o varios archivos.",
          kind: "assignment",
        },
        {
          title: "Recurso descargable",
          text: "Uno o varios archivos para descargar (Word, Excel, ZIP, imágenes…). Sube varios a la vez, reordénalos con las flechas y quita los que sobren. Se marca como visto cuando el alumno descarga cualquiera.",
          kind: "resource",
        },
        {
          title: "Enlace externo",
          text: "Un vínculo a otra página (normativa oficial, sitio interno). Escribe la URL y una descripción; «Probar enlace» lo abre en una pestaña nueva. Se marca como visto al abrirlo.",
          kind: "link",
        },
        {
          title: "Requerido, visible y carga masiva",
          text: "Cada lección tiene dos interruptores: «Visible» (el alumno la ve) y «Requerido para completar» (cuenta para aprobar). Para muchos contenidos usa «Importar CSV» y luego sube los archivos.",
          scene: "teacher-contenido-9",
          tip: "Marca «Requerido» solo en lo que realmente cuenta para aprobar; lo opcional queda sin candado.",
        },
      ],
    },
    {
      id: "reglas",
      title: "Reglas para aprobar",
      section: "courses",
      intro:
        "Las reglas deciden cuándo un alumno «completa» el curso. Combina condiciones con Y / O: por ejemplo, 100 % de contenidos vistos Y promedio de exámenes ≥ 80.",
      steps: [
        {
          title: "Edita las reglas",
          text: "En la pestaña «Reglas de aprobación» añade condiciones por tipo: contenidos vistos, promedio de exámenes, examen específico aprobado o completar todo lo requerido. Arriba eliges cómo se combinan: «todas (Y)» exige cumplirlas todas; «al menos una (O)» basta con una. El «?» de cada condición muestra en animación cuándo se cumple.",
          scene: "teacher-reglas-1",
          ui: ["todas (Y)", "al menos una (O)"],
        },
        {
          title: "Re-evaluación automática",
          text: "Cada vez que un alumno avanza, el sistema vuelve a evaluar las reglas. Al cumplirlas, el curso pasa a «Completado» y se genera su certificado si el curso tiene plantilla.",
          scene: "teacher-reglas-2",
          ui: ["En progreso", "Completado"],
        },
      ],
    },
    {
      id: "alumnos",
      title: "Inscribir estudiantes",
      section: "students",
      intro: "Los alumnos solo ven los cursos donde están inscritos.",
      steps: [
        {
          title: "Crear un estudiante",
          text: "Antes, búscalo en «Estudiantes»: quizá otro maestro ya lo registró. Si no está, pulsa «Nuevo estudiante»: nombre y correo; la contraseña temporal se genera sola y se muestra una sola vez (cópiala). Al terminar, «Matricular en cursos» te lleva directo a inscribirlo.",
          href: "/teach/students",
          hrefLabel: "Estudiantes",
          ui: ["Nuevo estudiante", "Copiar credenciales", "Matricular en cursos"],
        },
        {
          title: "Matrícula masiva desde el perfil",
          text: "En el perfil del alumno, «Matricular en cursos» abre una lista con todos tus cursos donde aún no está inscrito: marca varios (o «Seleccionar todos») y confírmalo de una vez. También puedes inscribir desde la pestaña Estudiantes de cada curso.",
          ui: ["Matricular en cursos", "Seleccionar todos"],
        },
        {
          title: "Importar por CSV",
          text: "Para grupos grandes sube un CSV con nombre y correo: se crean las cuentas con contraseña temporal y puedes descargar el resultado para dictarlas. La misma pantalla permite exportar tu lista actual.",
          scene: "teacher-alumnos-3",
          ui: ["Importar CSV", "Descargar plantilla"],
        },
        {
          title: "Perfil del estudiante y portafolio",
          text: "Haz clic en un alumno para ver su última conexión, cursos con progreso, certificados (incluso revocados) y acciones: restablecer contraseña, enviar el acceso por correo, desactivar. «Portafolio ZIP» descarga todos sus certificados para el expediente físico.",
          ui: ["Portafolio ZIP", "Restablecer contraseña"],
        },
        {
          title: "Una sola base de alumnos",
          text: "La base de alumnos es una sola para todos los maestros: un alumno que registra cualquier maestro queda disponible para todos, así que no hace falta volver a darlo de alta. «Estudiantes» abre en «Todos los alumnos»; «Mis alumnos» muestra solo a quienes diste de alta y a quienes están o estuvieron en tus cursos. Puedes abrir la ficha de cualquiera y matricularlo en tus cursos, pero de él solo ves tus cursos, su avance y tus certificados. Si registras un correo que ya existe, te ofrece matricular a ese alumno. Puedes reactivar la cuenta de tus alumnos, pero solo puedes restablecer su contraseña o desactivarla si el alumno está únicamente en tus cursos; si también toma cursos con otro maestro, pídeselo al administrador. Para sacarlo solo de tu curso usa «Quitar del curso», que no afecta sus otros cursos.",
          href: "/teach/students",
          hrefLabel: "Estudiantes",
          ui: ["Todos los alumnos", "Mis alumnos", "Matricular en cursos", "Quitar del curso"],
        },
        {
          title: "Importar estudiantes con IA",
          text: "Si tu lista no está en la plantilla, «Importar con IA» lee hasta 5 archivos en cualquier formato (Excel, Word, PDF, CSV, fotos o capturas, incluso PDF escaneados) y saca el nombre, el correo y el grupo de cada persona. Antes de crear nada ves la tabla: corriges nombres o correos, quitas o agregas filas, y cada fila dice si se creará, si ya tiene cuenta o qué le falta. Puedes matricularlos en un curso y usar los grupos que traía la lista. Al final descargas las credenciales. También está en la pestaña «Estudiantes» de cada curso.",
          href: "/teach/students",
          hrefLabel: "Estudiantes",
          ui: ["Importar con IA", "Agregar fila", "Usar los grupos de la lista", "Descargar credenciales (CSV)"],
          tip: "La IA nunca inventa correos: si alguien no trae correo en el archivo, la fila queda marcada para que lo escribas tú.",
        },
      ],
    },
    {
      id: "grupos",
      title: "Grupos y papelera",
      section: "students",
      intro:
        "Cada curso tiene sus propios grupos: separan las oleadas de alumnos (por ejemplo, «Generación Septiembre 2026») para que cada vista muestre solo a la gente con la que trabajas ahora. Cerrar un grupo solo lo guarda; «Eliminar» borra el grupo, no a sus alumnos, que siguen en el curso sin grupo.",
      steps: [
        {
          title: "Crear y cerrar grupos",
          text: "En «Grupos» ves los grupos de todos tus cursos (filtra por curso) con sus matrículas y aprobados. «Nuevo grupo» pide el curso y un nombre claro (mes, turno o área). Cuando una generación termina, «Cerrar» la saca de la lista del curso, los reportes y las estadísticas; «Reabrir» la devuelve.",
          href: "/teach/groups",
          hrefLabel: "Grupos",
          ui: ["Nuevo grupo", "Cerrar", "Reabrir"],
        },
        {
          title: "Inscribir: alumnos o un grupo de otro curso",
          text: "En la pestaña Estudiantes del curso, «Matricular estudiantes» tiene dos caminos: elegir alumnos y asignarlos a un grupo del curso (o crear uno), o «Traer grupo de otro curso», que inscribe de golpe a toda una generación en un grupo con el mismo nombre. El grupo original no cambia y quien ya estaba inscrito se queda igual. Si te equivocas, selecciona alumnos en la lista y usa «Mover a grupo».",
          scene: "teacher-grupos-2",
          ui: ["Elegir estudiantes", "Traer grupo de otro curso", "Mover a grupo"],
        },
        {
          title: "Filtrar por grupo",
          text: "La lista del curso, Reportes y Estadísticas tienen un selector con los grupos de ESE curso. Por defecto muestra los grupos abiertos y a quienes no tienen grupo; elige «Todos (incl. cerrados)», «Sin grupo» o uno en particular.",
          tip: "Aunque haya cientos de inscritos, cerrar las generaciones terminadas deja cada vista con solo las personas en curso.",
        },
        {
          title: "Papelera: bajas reversibles",
          text: "«Quitar del curso» no borra nada: el alumno pasa a la Papelera del curso con su avance, calificaciones y certificado intactos. Desde ahí lo restauras (uno o varios) y vuelve exactamente con el estatus que tenía. Volver a inscribirlo hace lo mismo. «Eliminar definitivamente» borra esas bajas para siempre con su avance (no sus cuentas); las que tienen certificado se quedan.",
          scene: "teacher-grupos-4",
          ui: ["Papelera", "Restaurar", "Eliminar definitivamente"],
        },
      ],
    },
    {
      id: "calificar",
      title: "Calificar",
      section: "grading",
      intro: "Todo lo que requiere revisión humana llega a una sola cola, de lo más antiguo a lo más reciente. Filtra por curso o por tipo (exámenes / tareas).",
      steps: [
        {
          title: "Tareas",
          text: "A la izquierda la cola; a la derecha la entrega: respuesta escrita, archivos (pulsa «Ver» para previsualizar PDF o imagen sin descargar; el icono ⤓ descarga) y comentario del alumno. Asigna puntos y retroalimentación, o «Devolver para corrección» para que vuelva a entregar.",
          scene: "teacher-calificar-1",
          href: "/teach/grading",
          hrefLabel: "Por calificar",
          ui: ["Ver", "Calificar y siguiente", "Devolver para corrección"],
        },
        {
          title: "Preguntas abiertas de examen",
          text: "Las de opción múltiple se califican solas; las abiertas esperan tu puntaje. Verás la pregunta, la respuesta del alumno y el máximo de puntos. Al terminar, el intento se cierra, se recalcula el promedio y se reevalúan las reglas del curso.",
          scene: "teacher-calificar-2",
        },
      ],
    },
    {
      id: "reportes",
      title: "Reportes y estadísticas",
      section: "reports",
      intro: "Matriz alumno × lección con estado y porcentaje; exportable a CSV para Excel.",
      steps: [
        {
          title: "Progreso por estudiante",
          text: "Elige el curso, filtra «En riesgo» (sin actividad reciente) o «Completados», busca por nombre y descarga el CSV. Pasa el cursor sobre una celda para ver detalle; haz clic para abrir la ficha del alumno en esa lección.",
          href: "/teach/reports",
          hrefLabel: "Reportes",
          ui: ["En riesgo", "Completados", "Exportar CSV"],
        },
        {
          title: "Estadísticas del curso",
          text: "Pestaña «Estadísticas» dentro del curso: matriculados, quiénes iniciaron, aprobados, tiempo promedio, distribución de avance y completitud por lección; abajo, promedio por examen y preguntas más falladas.",
        },
      ],
    },
    {
      id: "certificados",
      title: "Certificados",
      section: "certificates",
      intro: "Cada certificado tiene folio único y código QR verificable desde cualquier navegador de la red.",
      steps: [
        {
          title: "Diseña la plantilla",
          text: "En «Certificados» crea o edita una plantilla: elige un estilo (Académico, Elegante, Corporativo…) o sube tu propio fondo, activa/desactiva campos (nombre, curso, fecha, instructor, folio, QR) y prueba con «Generar PDF de prueba».",
          href: "/teach/templates",
          hrefLabel: "Certificados",
          ui: ["Generar PDF de prueba", "Guardar"],
        },
        {
          title: "Acomoda los campos con precisión",
          text: "Arrastra cada campo sobre el lienzo: aparecen guías rojas al alinearse con el centro, los márgenes o con otros campos, y cotas azules en mm. Shift+clic selecciona varios; la barra superior alinea, centra y distribuye. Ctrl+Z deshace; flechas mueven 1 pt (Shift = 10).",
          scene: "teacher-certificados-2",
          ui: ["Alinear", "Centrar", "Distribuir", "Imán", "Cuadrícula", "Reglas"],
        },
        {
          title: "Emisión automática",
          text: "Asigna la plantilla en Ajustes del curso. Al cumplir las reglas, el certificado se genera solo (folio + QR) y el alumno recibe una notificación. Puedes revocar uno desde la lista de emitidos si hubo un error.",
          ui: ["Revocar"],
        },
        {
          title: "Descarga física",
          text: "Desde el curso descarga todos los certificados en un ZIP para imprimir o archivar; desde el perfil del alumno, su portafolio completo. El QR lleva a /verify/‹folio›, que muestra si es auténtico o fue revocado.",
          ui: ["Descargar ZIP", "Portafolio ZIP"],
        },
        {
          title: "Plantillas generales",
          text: "Además de tus plantillas, puedes usar las plantillas generales que diseña el administrador: elígelas en los Ajustes del curso. Las ves en Certificados, pero no puedes editarlas.",
          href: "/teach/templates",
          hrefLabel: "Certificados",
          ui: ["Plantillas generales"],
        },
      ],
    },
    {
      id: "vencimientos",
      title: "Vigencia y recertificación",
      section: "renewals",
      intro:
        "Algunos cursos se toman una sola vez; otros deben renovarse (por ejemplo, cada año por norma). Cada curso define la vigencia de sus certificados y el panel de Vencimientos te dice quién necesita renovar. Nada se hace solo: tú decides.",
      steps: [
        {
          title: "Define la vigencia del curso",
          text: "En Ajustes del curso, tarjeta «Vigencia del certificado»: Vitalicio, Año calendario (vence el 31 de diciembre del año en que se aprueba) o un número de meses desde que se aprueba. Verás un ejemplo de la fecha de vencimiento. El cambio aplica a los certificados que se emitan de ahí en adelante.",
          ui: ["Vitalicio", "Año calendario", "Meses desde que se aprueba"],
        },
        {
          title: "Muestra la vigencia en el diploma",
          text: "En el editor de plantillas agrega el campo «Vigencia» (se imprime como «Vigente hasta el 31 de diciembre de 2026»); en los certificados vitalicios se omite solo. La página del QR indica si el certificado está vigente o ya venció.",
          ui: ["Vigencia"],
        },
        {
          title: "Panel de Vencimientos",
          text: "En «Vencimientos» hay dos pestañas: «Por vencer» (próximos 30 días) y «Vencidos». Filtra por curso, grupo o nombre y descarga la vista en CSV. Las cuentas desactivadas se marcan para que sepas que esa persona ya no está.",
          scene: "teacher-vencimientos-3",
          href: "/teach/renewals",
          hrefLabel: "Vencimientos",
          ui: ["Por vencer", "Vencidos", "Descargar CSV"],
        },
        {
          title: "Reinscribir o descartar",
          text: "Selecciona a quienes deben renovar y pulsa «Reinscribir»: se abre un ciclo nuevo en cero, en su mismo grupo o en otro, y el certificado anterior se conserva con su historial. Si alguien no debe renovar (se dio de baja, lo cubre otro curso o NOM), usa «Descartar» con el motivo: sale del panel y queda registrado.",
          ui: ["Reinscribir", "Descartar"],
        },
      ],
    },
    {
      id: "ayuda",
      title: "Ayuda visual: el «?»",
      section: "settings",
      intro:
        "Junto a los ajustes que no se entienden solo con el nombre hay un «?» índigo. Al pasar el cursor (o tocarlo en el celular) aparece una animación de 7 a 10 segundos que muestra qué cambia ese ajuste, con el valor que tienes puesto aunque aún no lo guardes.",
      steps: [
        {
          title: "Ábrelo con el cursor, un clic o el teclado",
          text: "Al pasar el cursor se abre; si haces clic se queda fija hasta que hagas clic fuera o presiones Esc. Con el teclado: Tab hasta el «?» y Enter. Si cambias el valor con la tarjeta abierta (por ejemplo, de 3 a 5 intentos), la animación vuelve a empezar con el valor nuevo.",
          ui: ["?"],
        },
        {
          title: "Catálogo de ayuda visual",
          text: "En «Ayuda visual» (menú Cuenta) están las 34 animaciones agrupadas por pantalla, con controles para probar valores. Sirve para repasarlas de una vez o para capacitar a otro maestro.",
          href: "/teach/ayuda",
          hrefLabel: "Ayuda visual",
        },
      ],
    },
    {
      id: "ajustes",
      title: "Ajustes y guía",
      section: "settings",
      intro: "Tu cuenta y, si tienes permiso, la identidad de la empresa. Los dos accesos están en «Cuenta», al final del menú.",
      steps: [
        {
          title: "Nombre y contraseña",
          text: "En «Ajustes» cambia tu nombre, tu correo de acceso y tu contraseña (el correo y la contraseña piden la actual; al cambiar la contraseña se cierran tus otras sesiones).",
          href: "/ajustes",
          hrefLabel: "Ajustes",
        },
        {
          title: "Identidad de la empresa",
          text: "Si el administrador te dio el permiso, verás la tarjeta «Identidad de la empresa»: logo, nombre de la plataforma y portada (vectorial o foto) para el login y/o el panel, con miniatura de previsualización antes de guardar.",
        },
        {
          title: "Cómo leer esta guía",
          text: "Los pasos con animación muestran en pequeño lo que pasa: el contador de una lectura, los tramos vistos de un video, una entrega devuelta, la cola de calificar. Debajo de cada animación, «Ver la pantalla real» abre la captura de la plataforma. La animación arranca cuando llegas al paso y se detiene al salir; si tu sistema tiene activado «reducir movimiento», se ve quieta en su resultado.",
          ui: ["Ver la pantalla real"],
        },
      ],
    },
  ],
};
