# Plataforma de aprendizaje

LMS corporativo que corre en un equipo de la red local: cursos con lecciones,
documentos, video, exámenes y tareas; reglas de aprobación; certificados con
folio verificable, vigencia y recertificación; grupos de alumnos; reportes.

- **Instalación y operación:** [INSTALACION.md](INSTALACION.md)
- **Plan y fases del proyecto:** [PLANEACION.md](PLANEACION.md)
- **Guía de uso por rol:** dentro de la plataforma, en «Guía de uso».

## Comandos

El proyecto usa **pnpm** (no npm ni npx).

```powershell
pnpm install          # dependencias
pnpm db:migrate       # aplica migraciones a data/data.db
pnpm db:seed          # usuarios iniciales
pnpm dev              # desarrollo en http://localhost:3000
pnpm build            # compilación de producción
pnpm start            # servidor de producción
pnpm backup           # respaldo de la base y los archivos
pnpm storage check    # verifica que cada archivo exista y esté íntegro
pnpm db:check         # la base coincide con el esquema (claves foráneas, integridad)
pnpm db:rebuild       # servicio detenido: semilla + base nueva desde cero + recarga
```

Scripts de apoyo (datos demo, pruebas de humo):

```powershell
$env:NODE_OPTIONS="--conditions=react-server"; pnpm exec tsx scripts/smoke-f6.ts
pnpm smoke:help       # ayuda visual: historias de las 35 escenas y sus textos
pnpm smoke:rules      # reglas de aprobación con Y / O contra el motor real
pnpm smoke:results    # publicar resultados de exámenes: regla, avisos y worker
pnpm smoke:guide      # guías animadas: historias de las escenas y su registro
pnpm smoke:ordering   # preguntas de ordenar pasos: puntaje por pares, barajado y CSV
pnpm smoke:ai         # importar con IA sin gastar: clave cifrada, lectura de archivos e imágenes, OpenAI simulado
pnpm smoke:ai --live  # además, una transcripción real de texto y de una imagen con la clave de Configuración (necesita internet)
pnpm help:shots       # con el servidor arriba: fotos de cada escena del catálogo
pnpm help:tips        # con el servidor arriba: abre cada «?» en pantallas reales
pnpm guide:scenes     # con el servidor arriba: fotos de las escenas de la guía
```
