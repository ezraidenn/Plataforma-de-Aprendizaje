import type { RoleGuide } from "./types";

export const ADMIN_GUIDE: RoleGuide = {
  role: "admin",
  label: "Administrador",
  tagline: "Cuentas, identidad de la empresa, respaldos y supervisión.",
  sections: [
    {
      id: "usuarios",
      title: "Usuarios",
      section: "admin",
      intro:
        "Crea cuentas, asigna roles y atiende contraseñas olvidadas. Además de esto, como administrador puedes hacer todo lo que hace un maestro (el menú «Administración» aparece al final).",
      steps: [
        {
          title: "Crear usuario",
          text: "En «Usuarios» pulsa «Nuevo usuario»: nombre, correo y rol (administrador, maestro o estudiante). Se genera una contraseña temporal para dictarla en persona; se muestra una sola vez.",
          scene: "admin-usuarios-1",
          href: "/admin/users",
          hrefLabel: "Usuarios",
          ui: ["Nuevo usuario", "Restablecer contraseña"],
        },
        {
          title: "Menú de acciones por usuario",
          text: "El menú ⋯ de cada fila permite: editar datos (nombre y correo con el que inicia sesión), restablecer contraseña (una temporal o la que escribas), cambiar rol, activar/desactivar y —en maestros— conceder «Puede editar identidad».",
          ui: ["Editar datos", "Restablecer contraseña", "Cambiar rol", "Desactivar"],
        },
        {
          title: "Activar / desactivar",
          text: "Desactivar una cuenta cierra sus sesiones y le impide entrar, sin borrar su historial ni certificados. No puedes desactivar al único administrador ni tu propia cuenta.",
          scene: "admin-usuarios-3",
          ui: ["Activo", "Inactivo"],
        },
        {
          title: "Eliminar definitivamente",
          text: "Para cuentas creadas por error o de prueba: borra la cuenta con sus inscripciones, progreso, intentos y entregas. Pide dos confirmaciones (ver qué se borra y escribir su correo). No se puede con quien tiene certificados emitidos (son registros históricos: desactívala) ni con dueños de cursos o plantillas (reasígnalos antes).",
          ui: ["Eliminar definitivamente"],
        },
        {
          title: "Permiso de identidad",
          text: "A un maestro de confianza puedes activarle «Puede editar identidad» para que cambie logo, nombre y portada desde sus Ajustes. Aparece la etiqueta «Identidad» junto a su rol.",
          scene: "admin-usuarios-4",
          ui: ["Identidad"],
        },
      ],
    },
    {
      id: "cursos",
      title: "Todos los cursos",
      section: "admin",
      intro: "Vista global de los cursos de todos los maestros.",
      steps: [
        {
          title: "Reasignar dueño",
          text: "Si un maestro deja la empresa, reasigna sus cursos a otro desde «Todos los cursos» (menú ⋯ → Reasignar). El historial de los alumnos se conserva intacto.",
          scene: "admin-cursos-1",
          href: "/admin/courses",
          hrefLabel: "Todos los cursos",
          ui: ["Reasignar"],
        },
        {
          title: "Ver el contenido de otro maestro",
          text: "Junto a la campana está el selector de contexto. «Mi contenido» muestra solo lo tuyo; «General — todos» junta los cursos, alumnos y pendientes de todos los maestros, con la etiqueta de quién es cada curso; y «Ver como maestro» te muestra exactamente lo que ve ese maestro. Fuera de «Mi contenido» aparece una franja con «Volver a Mi contenido». Al recargar la página (F5) o volver a entrar, vuelves automáticamente a «Mi contenido». Lo que crees viendo como un maestro (curso, alumno o plantilla) queda a su nombre, y la auditoría registra que lo hiciste tú. La campana y los números del menú siempre cuentan solo lo tuyo.",
          href: "/teach/dashboard",
          hrefLabel: "Inicio",
          ui: ["Mi contenido", "General — todos", "Ver como maestro", "Volver a Mi contenido"],
        },
        {
          title: "Plantillas generales de diploma",
          text: "Las plantillas de certificado que creas como administrador son generales: cualquier maestro puede elegirlas en los Ajustes de su curso. Solo tú puedes editarlas o borrarlas; si borras una, los cursos que la usaban quedan sin plantilla.",
          href: "/teach/templates",
          hrefLabel: "Certificados",
          ui: ["Plantillas generales"],
        },
      ],
    },
    {
      id: "identidad",
      title: "Identidad y portada",
      section: "settings",
      intro: "Logo y nombre aparecen en el menú, el login y la verificación de certificados. La portada es opcional y está desactivada por defecto.",
      steps: [
        {
          title: "Logo y nombre",
          text: "En «Ajustes → Identidad de la empresa» sube el logo (PNG/JPG/WEBP, hasta 2 MB; ideal con fondo transparente) y escribe el nombre de la plataforma.",
          href: "/ajustes",
          hrefLabel: "Ajustes",
        },
        {
          title: "Portada",
          text: "Activa «Mostrar portada», elige una vectorial (6 diseños con la paleta de la plataforma) o sube una foto, y decide si se ve en el login, en el panel de inicio o en ambos. Las miniaturas del login y del panel te muestran el resultado antes de guardar.",
          scene: "admin-identidad-2",
          ui: ["Vectorial", "Foto", "Login", "Panel", "Ambas", "Guardar portada"],
        },
      ],
    },
    {
      id: "operacion",
      title: "Operación y trazabilidad",
      section: "admin",
      intro: "Lo que necesitas para mantener la plataforma sana.",
      steps: [
        {
          title: "Trabajos en segundo plano",
          text: "En «Configuración» verás la cola de trabajos (conversión de PowerPoint a PDF, generación de certificados, recordatorios de vencimiento). Si alguno falla, revisa el error y pulsa «Reintentar».",
          scene: "admin-operacion-1",
          href: "/admin/settings",
          hrefLabel: "Configuración",
          ui: ["Reintentar"],
        },
        {
          title: "Bitácora de auditoría",
          text: "Cada acción sensible (cambios de rol, contraseñas, emisión o revocación de certificados, cambios de identidad) queda registrada con usuario, fecha y detalle. Filtra por entidad para investigar.",
        },
        {
          title: "Dónde se guardan los archivos",
          text: "En «Ajustes → Carpeta de almacenamiento» ves la ruta actual y puedes apuntarla a otro disco o al NAS. Los archivos se guardan con nombres legibles (Cursos\<Curso>\<Módulo>\<Lección>), así que puedes navegarlos desde el explorador. La base de datos siempre se queda en el servidor: nunca en el NAS.",
          scene: "admin-operacion-3",
          href: "/ajustes",
          hrefLabel: "Ajustes",
          ui: ["Probar", "Guardar ruta"],
          tip: "Cambiar la ruta no mueve los archivos: copia primero con «pnpm storage move --to «ruta»», que verifica cada copia por hash.",
        },
        {
          title: "Certificados sin archivo",
          text: "Los certificados no ocupan espacio en disco: se generan al descargarlos desde la copia de la plantilla que se congela al emitirlos. Por eso son idénticos al original aunque después edites la plantilla, y el respaldo se mantiene pequeño.",
          scene: "admin-operacion-4",
        },
        {
          title: "Respaldos",
          text: "Ejecuta «pnpm backup» en el servidor (o prográmalo en el Programador de tareas de Windows). Crea una copia de la base de datos y de los archivos en la carpeta backups/. Guarda una copia fuera del equipo.",
          tip: "Antes de actualizar la plataforma, haz un respaldo.",
        },
        {
          title: "Instalación y red",
          text: "La guía técnica (requisitos, LibreOffice para PowerPoint, arranque como servicio, puerto 3000 y acceso desde la red local/celulares) está en INSTALACION.md. Recuerda abrir el puerto en el firewall de Windows.",
        },
        {
          title: "Inteligencia artificial",
          text: "En «Configuración → Inteligencia artificial (OpenAI)» pega la clave de API, pulsa «Probar conexión» (no gasta saldo) y luego «Guardar». La clave se guarda cifrada y después solo se ve enmascarada. Con ella, los maestros ven «Importar con IA» en el editor de examen; sin clave, el botón no aparece. El texto de un archivo se envía a OpenAI solo cuando un maestro lo pide, y para eso el servidor necesita internet.",
          href: "/admin/settings",
          hrefLabel: "Configuración",
          ui: ["Probar conexión", "Guardar", "Quitar clave"],
          tip: "Modelo recomendado: gpt-5.6-terra; gpt-5.6-luna es más económico. Si cambia el APP_SECRET del .env (por ejemplo, al mover la base a otro equipo), vuelve a pegar la clave.",
        },
      ],
    },
  ],
};
