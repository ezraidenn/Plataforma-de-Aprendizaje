import { NextRequest, NextResponse } from "next/server";
import { VIEW_COOKIE, isDocumentLoad, stripCookie } from "@/lib/view-context";

// El middleware corre en Edge runtime (sin acceso a SQLite): hace solo el
// chequeo optimista de presencia de cookie. La validación real de la sesión
// y del rol la hacen los guards en cada layout/página (server components).

// Las de acceso por correo (crear/restablecer contraseña) también: se abren sin sesión
const PUBLIC_PATHS = ["/login", "/verify", "/crear-contrasena", "/restablecer", "/recuperar"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // /api no pasa por aquí (ver matcher); si algún día se incluye, que no redirija:
  // esas rutas hacen su propia autenticación (devuelven 401)
  if (pathname.startsWith("/api")) return NextResponse.next();

  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
  const hasSession = request.cookies.has("session");

  if (!isPublic && !hasSession) {
    const login = new URL("/login", request.url);
    // Tras iniciar sesión, loginAction regresa a la ruta que se intentó abrir
    if (pathname !== "/") login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }

  if (pathname === "/login" && hasSession) {
    // El destino exacto por rol lo resuelve la página raíz
    return NextResponse.redirect(new URL("/", request.url));
  }

  // Contexto de vista del admin: vive mientras se navega DENTRO de la app. Una
  // carga completa (F5, Ctrl+Shift+R, reabrir, pestaña nueva) vuelve a «Mi
  // contenido». Se quita también de ESTA petición para que la pantalla ya se
  // arme sin él. Las rutas /api salieron antes (descargar un ZIP no lo borra) y
  // las públicas no cuentan: abrir /verify en otra pestaña no lo reinicia.
  if (!isPublic && request.cookies.has(VIEW_COOKIE) && isDocumentLoad(request.method, request.headers)) {
    const headers = new Headers(request.headers);
    const kept = stripCookie(request.headers.get("cookie") ?? "", VIEW_COOKIE);
    // (Nunca queda vacía aquí: sin «session» ya se redirigió a /login; se cubre por si acaso)
    if (kept) headers.set("cookie", kept);
    else headers.delete("cookie");
    const response = NextResponse.next({ request: { headers } });
    response.cookies.delete(VIEW_COOKIE);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  // Todo excepto /api, estáticos y archivos de Next. /api queda fuera porque cada
  // ruta hace su propia autenticación y porque Next recorta a 10 MB el cuerpo de
  // toda petición que pasa por el middleware (middlewareClientMaxBodySize): las
  // subidas grandes llegaban cortadas.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)).*)"],
};
