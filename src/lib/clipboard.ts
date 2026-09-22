/**
 * Copia texto al portapapeles; devuelve si lo logró (nunca lanza).
 *
 * `navigator.clipboard` solo existe en contextos seguros (HTTPS o localhost).
 * En la LAN la plataforma se abre por http://<IP>:3000, así que ahí se usa el
 * método clásico: un textarea temporal + execCommand("copy").
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (window.isSecureContext && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Permiso denegado u otro fallo: intentar el método clásico
    }
  }

  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  // Junto al botón que se pulsó: los diálogos atrapan el foco y no dejarían
  // seleccionar un textarea puesto fuera de ellos (p. ej. en <body>)
  (previous?.parentElement ?? document.body).appendChild(textarea);
  textarea.focus();
  textarea.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  textarea.remove();
  previous?.focus();
  return ok;
}
