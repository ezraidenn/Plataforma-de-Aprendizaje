import type { RoleGuide } from "./types";

export const STUDENT_GUIDE: RoleGuide = {
  role: "student",
  label: "Estudiante",
  tagline: "Cómo tomar tus cursos y obtener tu certificado.",
  sections: [
    {
      id: "entrar",
      title: "Entrar a la plataforma",
      section: "home",
      intro: "Usa el correo y la contraseña que te dio tu instructor. La primera vez conviene cambiar la contraseña.",
      steps: [
        {
          title: "Inicia sesión",
          text: "Escribe tu correo y contraseña y pulsa «Entrar». Si la olvidaste, pide a tu instructor o al administrador que te la restablezca (te dará una temporal).",
        },
        {
          title: "Tu panel",
          text: "Verás tus cursos con barra de avance, el botón «Continuar» para retomar donde te quedaste, lo pendiente por hacer y tus certificados. En el celular, el menú se abre con el botón ☰ de la barra superior.",
          href: "/dashboard",
          hrefLabel: "Ir a mi panel",
          ui: ["Continuar", "En progreso", "Completado"],
        },
      ],
    },
    {
      id: "curso",
      title: "Dentro de un curso",
      section: "courses",
      intro:
        "El contenido está en orden. Si el curso es secuencial verás un candado en las lecciones que todavía no puedes abrir: se desbloquean al terminar la anterior.",
      steps: [
        {
          title: "Continúa donde te quedaste",
          text: "En la página del curso ves el árbol de lecciones con su estado (✓ hecho, ◐ en progreso, 🔒 bloqueado). El botón «Continuar» te lleva a la siguiente pendiente. Cada tipo tiene su color e icono.",
          scene: "student-curso-1",
          ui: ["Continuar", "Siguiente lección"],
        },
        {
          title: "Documentos (PDF)",
          text: "Avanza página por página. Cada hoja necesita unos segundos en pantalla para contar: arriba a la derecha, el contador te dice cuánto falta en esta página y cuánto en todo el documento. El botón «Siguiente» se habilita cuando la página quedó acreditada. No puedes brincarte hojas.",
          kind: "document",
          scene: "student-curso-2",
          ui: ["Faltan 0:18", "Página leída"],
        },
        {
          title: "Lecturas",
          text: "Lee con calma: hay un tiempo mínimo de lectura y el contador de arriba a la derecha muestra cuánto falta. Cuando llega a cero aparece «Lectura completada» y se habilita «Continuar». Si cambias de pestaña, el contador se pausa.",
          kind: "text",
          scene: "student-curso-3",
          ui: ["Faltan 1:30", "Lectura completada"],
        },
        {
          title: "Videos",
          text: "Solo cuentan los tramos realmente vistos. El contador indica cuánto video te falta y avanza mientras reproduces contenido nuevo; si adelantas o repites lo ya visto, no baja. Puedes pausar y retomar en cualquier momento (el video reanuda donde ibas).",
          kind: "video",
          scene: "student-curso-4",
          ui: ["En pausa", "Video completado"],
        },
        {
          title: "Recursos y enlaces",
          text: "Un recurso es una lista de archivos para descargar (formatos, normas, plantillas): al descargar cualquiera queda marcado como visto. Un enlace externo se marca al abrirlo con «Abrir enlace».",
          kind: "resource",
        },
      ],
    },
    {
      id: "examen",
      title: "Exámenes",
      section: "courses",
      intro: "Antes de empezar verás intentos disponibles, tiempo límite y calificación mínima.",
      steps: [
        {
          title: "Antes de comenzar",
          text: "La pantalla previa muestra cuántos intentos tienes, el tiempo límite y el mínimo para aprobar. Cuando pulses «Comenzar intento» el reloj arranca.",
          scene: "student-examen-1",
          kind: "exam",
          ui: ["Comenzar intento"],
        },
        {
          title: "Responde y envía",
          text: "Puedes moverte entre preguntas y ver cuáles faltan. Al enviar, las de opción múltiple se califican al instante; las abiertas las revisa tu instructor y verás «Pendiente de revisión» hasta entonces. En las preguntas de ordenar pasos, acomódalos arrastrándolos o con las flechas. En las preguntas sobre una imagen, arrastra cada ficha a su lugar (o tócala y luego toca el lugar) o marca los puntos que se piden. Para clasificar, lleva cada tarjeta a su grupo de la misma forma; para completar un texto, escribe lo que falta, pon una palabra del banco o elige de la lista en cada hueco.",
          scene: "student-examen-2",
          ui: ["Enviar respuestas", "Pendiente de revisión"],
        },
        {
          title: "¿No aprobaste?",
          text: "Si quedan intentos, puedes volver a presentarlo. Se toma en cuenta el mejor resultado (o el último, según lo configure tu instructor).",
          scene: "student-examen-3",
        },
      ],
    },
    {
      id: "tarea",
      title: "Tareas",
      section: "courses",
      intro: "Funcionan como en Teams: lees las instrucciones, descargas el material de apoyo y entregas.",
      steps: [
        {
          title: "Prepara tu entrega",
          text: "Escribe tu respuesta en el cuadro de texto (puedes dar formato y pegar desde Word) y/o adjunta archivos (varios, hasta 10). Cada archivo sube al elegirlo; puedes quitarlo antes de entregar. El botón «Entregar» se activa cuando hay texto o al menos un archivo.",
          kind: "assignment",
          ui: ["Entregar"],
        },
        {
          title: "Fecha límite y estados",
          text: "Si la tarea ya venció solo podrás entregar si tu instructor permitió entregas tardías (quedará marcada). Los estados son: Entregada → Calificada (con puntos) o Devuelta (para corregir y volver a entregar).",
          scene: "student-tarea-2",
          ui: ["Entregada", "Tardía", "Calificada", "Devuelta"],
        },
        {
          title: "Retroalimentación",
          text: "Cuando te califiquen verás los puntos y los comentarios del instructor. Si la devuelve para corregir, aparece el formulario de nuevo para reentregar.",
          scene: "student-tarea-3",
        },
      ],
    },
    {
      id: "certificado",
      title: "Tu certificado",
      section: "certificates",
      intro: "Al cumplir las reglas del curso (por ejemplo, todo visto y exámenes aprobados) el certificado se genera automáticamente.",
      steps: [
        {
          title: "Descárgalo",
          text: "En «Mis certificados» pulsa «Descargar PDF». Tiene folio único y código QR. Recibirás una notificación en la campana cuando se emita.",
          href: "/dashboard#certificados",
          hrefLabel: "Mis certificados",
          ui: ["Descargar PDF"],
        },
        {
          title: "Verificación",
          text: "Cualquiera puede escanear el QR (o abrir /verify/‹folio›) para comprobar que el certificado es auténtico: muestra tu nombre, el curso y la fecha.",
        },
        {
          title: "Vigencia",
          text: "Algunos cursos se renuevan periódicamente (por ejemplo, cada año por norma). Junto a cada certificado verás si es vitalicio, hasta cuándo está vigente, si está por vencer o si ya venció. Cuando toque renovarlo, tu instructor te volverá a inscribir: tomarás el curso de nuevo y obtendrás un certificado nuevo; el anterior se conserva.",
          scene: "student-certificado-3",
          ui: ["Vigente", "Por vencer", "Vencido", "Vitalicio"],
        },
      ],
    },
    {
      id: "ajustes",
      title: "Tu cuenta",
      section: "settings",
      intro: "Tu nombre y correo los administra tu instructor; tú controlas tu contraseña.",
      steps: [
        {
          title: "Cambiar contraseña",
          text: "En «Ajustes» (menú Cuenta) escribe la actual y la nueva (mínimo 8 caracteres). Por seguridad se cierran tus otras sesiones.",
          href: "/ajustes",
          hrefLabel: "Ajustes",
        },
        {
          title: "Notificaciones",
          text: "La campana de la barra superior te avisa cuando califican una tarea, cuando un curso nuevo está disponible o cuando se emite tu certificado. Cuando ya las revisaste, bórralas con la ✕ o con «Borrar todas» para dejarla en limpio.",
        },
      ],
    },
  ],
};
