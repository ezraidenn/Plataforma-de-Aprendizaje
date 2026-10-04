# Guía de instalación — Plataforma de Capacitación

> Instalación en la PC servidor de la empresa (Windows 10/11), accesible en la
> LAN vía `http://<IP-del-servidor>:3000`. Sin internet en operación normal
> (solo los ítems de video por enlace lo requieren en los equipos cliente).

---

## 1. Requisitos del servidor

| Componente | Detalle |
|---|---|
| Windows | 10 u 11 (también funciona en Windows Server) |
| CPU / RAM | 4+ núcleos, 8–16 GB RAM |
| Disco | SSD, 250 GB+ (según volumen de documentos y entregas) |
| Red | IP fija en la LAN (o reserva DHCP) |

## 2. Software base (una sola vez)

1. **Node.js LTS** — <https://nodejs.org> (instalador Windows, siguiente-siguiente).
2. **pnpm** — con el instalador oficial, en una terminal (PowerShell):
   ```powershell
   Invoke-WebRequest https://get.pnpm.io/install.ps1 -UseBasicParsing | Invoke-Expression
   ```
   Cierra y vuelve a abrir la terminal para que tome el PATH. Alternativa:
   `corepack enable pnpm` (Corepack viene con Node 24; requiere una terminal
   como administrador).
   > pnpm es el gestor de paquetes del proyecto (bloquea scripts de instalación
   > no autorizados). No usar npm ni npx: para ejecutar herramientas del
   > proyecto usa `pnpm <script>` o `pnpm exec <herramienta>`.
3. **LibreOffice** — <https://www.libreoffice.org/download/> (necesario SOLO para
   convertir PPT/PPTX; los PDF funcionan sin él). Instalación default en
   `C:\Program Files\LibreOffice`.
4. **NSSM** (para correr como servicio) — <https://nssm.cc/download>, descomprime
   y copia `nssm.exe` (carpeta win64) a `C:\Windows\System32` o a una carpeta en el PATH.

## 3. Instalar la plataforma

1. Copia la carpeta del proyecto al servidor, por ejemplo a `C:\plataforma`.
   (No copies `node_modules` ni `.next`; sí copia `data\` y `storage\` si migras datos.)
2. Configura `C:\plataforma\.env`:
   ```ini
   DATABASE_PATH=./data/data.db
   # Carpeta de archivos. Puede ser local o del NAS (\\\\NAS\\Capacitacion).
   # La base de datos SIEMPRE va en disco local.
   STORAGE_PATH=./storage
   # OBLIGATORIO cambiarlo: cadena aleatoria larga (firma los certificados y
   # las fichas de los exámenes; sin ella, los exámenes fallan con
   # «Falta APP_SECRET en el entorno»)
   APP_SECRET=<cadena-aleatoria-larga-y-secreta>
   SOFFICE_PATH=C:\Program Files\LibreOffice\program\soffice.exe
   # Dirección del servidor en la red: la que llevan impresa los QR de los
   # certificados. Si la omites, la plataforma detecta sola la IPv4 del equipo
   # (recomendado con DHCP). Fíjala solo si el servidor tiene IP fija o nombre DNS.
   # APP_URL=http://192.168.1.50:3000
   # Carpeta de respaldos (ideal: otro disco o carpeta de red)
   BACKUP_DIR=D:\respaldos-plataforma
   # Correo: servicio de correo de la red del club (orquestador). La clave es
   # secreta: solo vive aquí, nunca en el repositorio ni en el navegador.
   # Sin estas dos variables la plataforma funciona igual, pero no manda correos.
   CORREO_API_URL=http://10.0.0.10:8025
   CORREO_API_KEY=<clave-del-servicio-de-correo>
   ```
   > ⚠️ `APP_SECRET` distinto al de desarrollo y **nunca** se cambia después
   > (invalidaría la verificación de certificados ya emitidos).
   > La dirección detectada se ve en **Administración → Configuración → Dirección en la red**.
   > Es también la que llevan los enlaces de los correos: con DHCP, **reserva la IP
   > del servidor en el router** para que los enlaces enviados sigan sirviendo.
   > El estado del correo y un botón de prueba están en **Administración → Configuración → Correo**.
3. En una terminal dentro de `C:\plataforma`:
   ```powershell
   pnpm install
   pnpm db:migrate
   pnpm db:seed        # crea admin/maestro/estudiante demo — cambia sus contraseñas
   pnpm build
   ```
4. Prueba manual: `pnpm start` y abre `http://localhost:3000`. Entra con
   `admin@empresa.local / admin1234`, **cambia las contraseñas demo** (o crea
   usuarios reales y desactiva los demo desde Administración → Usuarios).
   Detén con Ctrl+C cuando confirmes que funciona.

## 4. Abrir el puerto en el firewall

PowerShell **como administrador**:
```powershell
New-NetFirewallRule -DisplayName "Plataforma Capacitacion" -Direction Inbound -Protocol TCP -LocalPort 3000 -Action Allow
```

## 5. Instalar como servicio de Windows (arranque automático)

PowerShell **como administrador**:
```powershell
# Ruta de node: normalmente C:\Program Files\nodejs\node.exe
$node = (Get-Command node).Source

nssm install PlataformaCapacitacion $node
nssm set PlataformaCapacitacion AppDirectory C:\plataforma
nssm set PlataformaCapacitacion AppParameters "node_modules\next\dist\bin\next start"
nssm set PlataformaCapacitacion DisplayName "Plataforma de Capacitacion"
nssm set PlataformaCapacitacion Start SERVICE_AUTO_START
nssm set PlataformaCapacitacion AppStdout C:\plataforma\logs\servicio.log
nssm set PlataformaCapacitacion AppStderr C:\plataforma\logs\servicio-error.log
nssm set PlataformaCapacitacion AppRotateFiles 1
nssm set PlataformaCapacitacion AppRotateBytes 10485760

New-Item -ItemType Directory -Force C:\plataforma\logs | Out-Null
nssm start PlataformaCapacitacion
```

Verifica: `http://<IP-del-servidor>:3000` desde otra PC de la red.

Comandos útiles: `nssm status|stop|start|restart PlataformaCapacitacion`,
logs en `C:\plataforma\logs\`.

## 6. Respaldo diario automático

El comando `pnpm backup` copia la base de datos (con la API segura de SQLite,
sin detener el servicio) y los archivos de `storage\` a `BACKUP_DIR`, y conserva
los últimos 14 respaldos de base.

Programarlo diario a las 2:00 am — PowerShell **como administrador**:
```powershell
$action  = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c cd /d C:\plataforma && pnpm backup >> logs\backup.log 2>&1"
$trigger = New-ScheduledTaskTrigger -Daily -At 2:00am
Register-ScheduledTask -TaskName "Respaldo Plataforma" -Action $action -Trigger $trigger -RunLevel Highest -Description "Respaldo diario de la plataforma de capacitacion"
```

**Restaurar**: detener el servicio → reemplazar `data\data.db` con el respaldo
deseado de `BACKUP_DIR\db\` → restaurar `storage\` desde `BACKUP_DIR\storage\`
→ iniciar el servicio.

## 7. Actualizar la plataforma (nuevas versiones)

```powershell
nssm stop PlataformaCapacitacion
pnpm backup          # respaldo antes de migrar: algunas migraciones rellenan datos
# reemplazar el código (sin tocar data\, storage\, .env)
pnpm install
pnpm db:migrate
pnpm db:check        # la base coincide con el esquema (claves foráneas e integridad)
Remove-Item -Recurse -Force .next   # compilación limpia: evita servir archivos de la versión anterior
pnpm build
nssm start PlataformaCapacitacion
```

Después de iniciar, abre la plataforma y fuerza la recarga del navegador
(Ctrl+F5) si ves errores 400 de archivos `_buildManifest`: es una pestaña que
quedó con la versión anterior.

### Reconstruir la base y llevar los datos a otro equipo

`pnpm db:rebuild` (con el servicio **detenido**; se niega si la base está en
uso) respalda `data.db`, vuelca todos los datos a una «semilla» SQL en
`backups\seed\`, crea una base nueva desde cero con todas las migraciones,
carga la semilla, verifica filas, integridad y claves, y solo entonces la
coloca en `data\data.db`. Sirve para dejar la base idéntica a una instalación
nueva.

Para llevar esos mismos datos a otro servidor (p. ej. el definitivo con NAS),
copia la semilla y, en el equipo nuevo ya instalado y **sin** `data\data.db`:

```powershell
node scripts/db-rebuild.cjs load backups\seed\seed-AAAA-MM-DD_HHMM.sql
pnpm db:check
```

Los archivos (documentos, entregas…) viajan aparte: copia la carpeta de
almacenamiento o apunta el equipo nuevo a la misma carpeta del NAS.

## 8. Almacenamiento: dónde viven los archivos

La plataforma separa **base de datos** y **archivos**:

| | Qué guarda | Dónde debe estar |
|---|---|---|
| `data\data.db` | Usuarios, cursos, progreso, calificaciones, folios | **Disco local del servidor.** Nunca en el NAS |
| Carpeta de almacenamiento | PDF, PowerPoint, entregas, logos, portadas | Disco local **o recurso del NAS** |

> ⚠️ SQLite en modo WAL no funciona de forma fiable sobre SMB: la base de datos
> se queda siempre en el servidor. Al NAS solo van los archivos.

### Estructura en disco

Los archivos se guardan con nombres legibles, iguales a lo que se ve en la
plataforma, para poder navegarlos y archivarlos desde el explorador:

```
\\NAS\Capacitacion\
├─ Cursos\
│  └─ Uso y Manejo de Extintores — NOM-002-STPS-2010\
│     ├─ _Portada.jpg
│     ├─ 01 Módulo 1 — Fundamentos del fuego\
│     │  ├─ 03 Manual del participante.pdf
│     │  └─ 03 Manual del participante (convertido).pdf
│     └─ 03 Módulo 3 — Práctica\
│        └─ 04 Formatos de inspección\
│           └─ formato-inspeccion-mensual.csv
├─ Entregas\
│  └─ <Curso>\<Tarea>\<Alumno> — <fecha>\<archivo>
└─ _Sistema\           (logo, portadas, fondos de plantilla, imágenes del editor)
```

La ruta de cada archivo la manda la base de datos: al renombrar un curso o una
lección desde la plataforma, la carpeta se mueve sola en segundo plano.
**No renombres ni muevas nada a mano**; si ocurre, `pnpm storage check` lo detecta.

Los **certificados no se guardan como archivo**: se generan al descargarlos
(~22 ms) a partir de la copia de la plantilla que se congela al emitirlos. Así el
NAS no acumula miles de PDF de 9 KB y el respaldo se mantiene ligero. El folio,
el hash de verificación y la página `/verify/<folio>` siguen dando la
trazabilidad de siempre.

### Apuntar la plataforma al NAS

1. Comparte una carpeta en el NAS y da permiso de **lectura y escritura** a la
   cuenta con la que corre el servicio (en NSSM: pestaña *Log on*). Con una
   cuenta de sistema, mapea el recurso como unidad de máquina o usa la ruta UNC.
2. Copia los archivos existentes y activa la ruta nueva:
   ```powershell
   cd C:\plataforma
   pnpm storage move --to "\\NAS\Capacitacion"
   ```
   Copia archivo por archivo, **verifica cada copia por hash** y solo entonces
   cambia la ruta activa. La carpeta anterior queda intacta: bórrala tú cuando
   compruebes que todo funciona.
3. También puedes cambiarla sin mover nada desde **Administración →
   Configuración → Carpeta de almacenamiento** (útil si ya copiaste el contenido
   por tu cuenta), o con `STORAGE_PATH` en `.env`. Precedencia:
   ajuste de la aplicación → `STORAGE_PATH` → `.\storage`.

### Mantenimiento

```powershell
pnpm storage where     # Ruta activa, de dónde sale y cuánto ocupa
pnpm storage check     # Integridad: archivos rotos, sobrantes o fuera de sitio
pnpm storage plan      # Qué reorganizaría (no toca nada)
pnpm storage apply     # Reorganiza; --purge-orphans borra lo que nada usa
```

Conviene ejecutar `pnpm storage check` después de restaurar un respaldo o si
alguien tocó las carpetas del NAS.

## 9. Problemas comunes

| Síntoma | Causa probable | Solución |
|---|---|---|
| Los PPT se quedan "en cola" o marcan error de conversión | LibreOffice no instalado o ruta mal en `SOFFICE_PATH` | Instalar LibreOffice / corregir `.env` / botón Reintentar en el curso, o Administración → Configuración → Trabajos → Reintentar |
| El QR del certificado no abre desde el teléfono | `APP_URL` fijada con una IP que cambió, o el teléfono está fuera de la red | Quitar `APP_URL` del `.env` para que se detecte sola, o corregirla; comprobar la dirección en Administración → Configuración |
| Nadie puede entrar desde otras PCs | Puerto cerrado | Regla de firewall del paso 4; verificar IP con `ipconfig` |
| El servicio no arranca tras reiniciar | Ruta de node cambió (actualización de Node) | `nssm edit PlataformaCapacitacion` y corregir la ruta |
| "database is locked" persistente | Antivirus escaneando `data\` | Excluir `C:\plataforma\data` y la carpeta de almacenamiento del antivirus |
| Los cursos no muestran sus archivos tras cambiar de carpeta | Se cambió la ruta sin copiar el contenido | `pnpm storage check` para confirmarlo; copiar los archivos o volver a la ruta anterior |
| "Sin permisos para crear o escribir" al guardar la ruta del NAS | El servicio corre con una cuenta sin acceso al recurso | NSSM → *Log on* con una cuenta del dominio con permiso, o dar permiso a la cuenta de equipo |
| Subidas lentas o cortadas hacia el NAS | Red saturada o suspensión del recurso | Usar cable en el servidor; revisar la energía/suspensión del NAS |
| El maestro no ve «Importar con IA» (examen o Estudiantes) | No hay clave de OpenAI guardada | Administración → Configuración → Inteligencia artificial: pegar la clave, «Probar conexión» y Guardar |
| «No hay conexión con OpenAI» al probar o al importar | El servidor no tiene internet o el firewall/proxy bloquea `api.openai.com` | Permitir la salida HTTPS (443) del servidor a `api.openai.com` |
| La tarjeta de IA dice que la clave ya no se puede leer | Cambió `APP_SECRET` (p. ej. se llevó la base a otro equipo sin su `.env`) | Volver a pegar la clave y Guardar; la clave se cifra con `APP_SECRET` |
| No llegan los correos | Faltan `CORREO_API_URL`/`CORREO_API_KEY`, el servicio de correo no responde o la dirección es de prueba (`@*.local`) | Administración → Configuración → Correo: ver el estado de cada correo (pasa el puntero sobre «Falló» o «No se envió» para leer el motivo) y «Enviarme un correo de prueba» |
| Los enlaces de los correos no abren | Cambió la IP del servidor después de enviarlos | Reservar la IP del servidor en el router (DHCP) o fijar `APP_URL`; reenviar con «Enviar acceso por correo» |
| La foto de iPhone no se acepta al importar con IA | Está en HEIC (formato de Apple que OpenAI no lee) | En el iPhone: Ajustes → Cámara → Formatos → «Más compatible», o guardarla como JPG antes de subirla |
