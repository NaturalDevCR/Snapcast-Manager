# Snapcast Manager — Auditoría y Diseño de Profesionalización

**Fecha:** 2026-08-18
**Estado:** Propuesta
**Versión base auditada:** v0.3.0 (`63a65d3`)
**Alcance:** backend (`server/`), frontend (`client/`), instalador (`scripts/`), CI (`.github/`)

---

## 1. Intención del producto

Snapcast Manager convierte un Debian/Ubuntu/Raspberry Pi en un **hub de audio multi-room
gestionable por web**: instala y actualiza el stack (snapserver, snapclient, ffmpeg,
shairport-sync, MPD, myMPD, snap-ctrl), edita `snapserver.conf` sin tocar la terminal,
gestiona fuentes de audio (pipes, TCP, ALSA, meta, AirPlay), enruta fuentes a zonas con
una matriz visual, corre múltiples instancias de `snapclient` en la misma máquina y
mantiene snapshots/backups restaurables.

Todo el diseño que sigue se subordina a esa intención. **La aplicación es, por naturaleza,
un panel de administración de sistema con privilegios de root sobre un host.** Ese es su
valor y también su mayor riesgo: el objetivo de la profesionalización no es quitarle poder,
sino hacer que ese poder sea *explícito, acotado, auditable y reversible*.

---

## 2. Estado actual — resumen ejecutivo

| Dimensión | Estado | Nota |
|---|---|---|
| Funcionalidad | Amplia y diferenciada | La matriz de audio y la gestión multi-instancia no existen en alternativas |
| Seguridad | **Crítica** | Inyección de comandos post-auth, escritura arbitraria como root, modelo de privilegios implícito |
| UI (sistema de diseño) | **Roto** | Tailwind v4 sin `@config`: 407 usos de `brand-*` compilan a cero CSS |
| UX / accesibilidad | Inmadura | 3 atributos `aria-*` en 157 botones; matriz solo con ratón; modo claro inservible |
| Arquitectura backend | Frágil | Shell string-building en todas partes, escrituras no atómicas, sin capa de validación |
| Rendimiento | Costoso | 5 vistas con polling (2–8 s); cada tick lanza varios procesos `systemctl`/`ss`/`ps` |
| Calidad / proceso | Insuficiente | 13 tests sobre 2 utils puros; CI solo en tags; sin linter; sin LICENSE |

### 2.1 Hallazgos verificados

Cada punto fue comprobado leyendo el código o ejecutando el build; no son sospechas.

#### Seguridad — P0

1. **Inyección de comandos vía `existingServiceName`.**
   `routes/pipeSources.ts:183` acepta el campo sin validar; `services/pipeSources.ts:517-519`
   lo interpola en `systemctl stop <x>`, `systemctl disable <x>` y `rm -f /etc/systemd/system/<x>.service`
   ejecutados por `exec` (shell). Un `;` basta para ejecución arbitraria como root.

2. **Inyección de comandos vía `:id` de instancias snapclient.**
   `routes/snapclientInstances.ts:60,96,110` pasan el parámetro de URL sin comprobar que la
   instancia exista; `services/snapclientInstances.ts:184-191,206` lo interpolan en
   `systemctl <action> snapclient-manager-<id>`, `rm -f .../snapclient-manager-<id>.service` y
   `journalctl -u ...`. `%3B` en la URL decodifica a `;`.

3. **Escritura arbitraria de ficheros como root, con bit de ejecución.**
   `POST /api/tools/scripts` (`routes/tools.ts:85-103`) registra *cualquier* ruta absoluta;
   `POST /api/tools/script` (`routes/tools.ts:138-159`) hace `sudo cp` + `sudo chmod +x` sobre
   ella. Destinos triviales: `/etc/sudoers.d/`, `/etc/cron.d/`, `/etc/systemd/system/`.
   Esto convierte cualquier sesión autenticada en root persistente.

4. **Contenido arbitrario de unidad systemd.**
   `PUT /api/pipe-sources/:id/config` (`services/pipeSources.ts:551-561`) escribe el body tal cual
   en `/etc/systemd/system/<unit>.service` y hace `daemon-reload` + `restart`. Es una función
   *pretendida*, pero sin validación ni advertencia: equivale a un shell remoto.

5. **Temporales predecibles en `/tmp` movidos como root.**
   `routes/tools.ts:33,65,152`, `services/pipeSources.ts:556,569,589`,
   `services/snapclientInstances.ts:90-91` escriben en rutas deterministas de `/tmp` y luego
   `sudo cp`/`sudo mv`. Un usuario local sin privilegios puede ganar la carrera con un symlink.
   Además `ExecStartPre` crea el FIFO con `mkfifo -m 666` en `/tmp` (`pipeSources.ts:112`).

6. **TLS deshabilitado en una descarga que acaba servida por snapserver.**
   `services/system.ts:693`: `wget --no-check-certificate -qO snap-ctrl.zip "$DOWNLOAD_URL"`.
   El artefacto se instala como `doc_root` del servidor HTTP de snapserver.

7. **Modelo de privilegios implícito.**
   `scripts/install.sh:581` fija `User=$USER_NAME` (quien lanzó el instalador; con
   `curl | sudo bash` es **root**). `services/config.ts:44,101` escribe `/etc/snapserver.conf`
   con `fs.writeFile` sin sudo, luego en la práctica el servicio *debe* correr como root.
   La unidad no tiene `NoNewPrivileges`, `ProtectSystem`, `PrivateTmp` ni `ReadWritePaths`.

8. **Sin política de contraseñas.** Ni `server/src/auth.ts` (setup / change-password) ni
   `views/Setup.vue` imponen longitud mínima. Se acepta una contraseña de un carácter.

9. **Gestión de sesión débil.** JWT en `localStorage` (`utils/api.ts:2`), sin refresh, sin
   revocación, sin logout servidor; 401/403 provocan `window.location.href` (recarga dura y
   pérdida de trabajo en el editor de config). El rate limit es en memoria y por proceso
   (`auth.ts:22-41`): se reinicia con el servicio.

10. **`.env` sin permisos restrictivos.** `install.sh:562-567` lo escribe sin `chmod 600`.

11. **Sin cabeceras de seguridad ni límites.** No hay Helmet/CSP, ni rate limit fuera de
    `/login`, ni timeouts de request, ni límite explícito de body.

12. **Fuga de detalle interno en errores.** Casi todas las rutas devuelven `err.message`, que
    en este código contiene el comando de shell completo que falló.

#### Corrección y fiabilidad — P1

13. **El sistema de color no existe en producción.** El proyecto usa Tailwind v4
    (`@import "tailwindcss"` en `style.css`, `@tailwindcss/postcss`), pero conserva un
    `tailwind.config.js` estilo v3 que **v4 no carga** (falta `@config` o un bloque `@theme`).
    Verificado: tras `vite build`, el CSS generado contiene **cero** reglas
    `.bg-brand-primary` / `.text-brand-primary` / `.bg-brand-bg`, frente a **407** usos de
    `brand-*` en el código fuente. Todo el acento morado/cian del producto es un no-op.

14. **Modo claro inservible.** `components/Layout.vue:97` aplica `text-white` a la raíz sin
    variante, y solo hay 29 usos de `dark:` en toda la app. Con `--brand-bg: #f8f9fa`, el
    texto blanco sobre fondo casi blanco es ilegible.

15. **Dependencia de CDN para tipografía e iconos.** `client/index.html` carga Inter y
    Material Symbols desde `fonts.googleapis.com`. En la instalación típica (Raspberry Pi en
    LAN sin salida a internet) los iconos se degradan a texto literal ("menu", "dashboard").

16. **Escrituras de configuración no atómicas.** `services/config.ts:44,101` usan `fs.writeFile`
    directo sobre `/etc/snapserver.conf`, sin temp+rename ni lock. Un corte de luz o dos
    peticiones concurrentes truncan la configuración del usuario.

17. **IDs colisionables.** `services/snapclientInstances.ts:132`: `inst-${Date.now()}`.

18. **Colisión de slugs en pipe sources.** `underscoreSlug`/`hyphenSlug`
    (`services/pipeSources.ts:58-64`) mapean "My Radio" y "my-radio" al mismo FIFO y a la misma
    unidad systemd; un nombre solo de símbolos produce `/tmp/snapfifo_` y `snapcast-radio-.service`.

19. **Watchdog siempre activo.** `services/watchdog.ts:38-54` arranca un `setInterval` de 4 s en
    el momento del import del router, lee el JSON de disco en cada tick y lanza `ss` por puerto.
    `ensureConfig()` cae silenciosamente a un directorio de desarrollo si `/etc/snapcast-manager`
    no es escribible, produciendo dos fuentes de verdad.

20. **Tormenta de polling.** Routing 2 s, Dashboard 3 s, Watchdogs 3 s, Logs 5 s, PipeSources 8 s.
    Cada tick del backend lanza varios procesos (`systemctl is-active` por servicio/instancia/pipe,
    `ps aux | grep defunct`, `ss`). No hay pausa con `document.hidden`, ni ETag, ni fuente única.
    Snapcast expone **WebSocket JSON-RPC con notificaciones push** en el mismo puerto 1780; el
    proyecto solo usa el POST HTTP (`utils/snapcastRpc.ts`).

21. **Jobs volátiles.** `services/jobs.ts` guarda todo en memoria, con una única ranura. Un
    reinicio a mitad de un `apt-get install` deja al cliente sondeando un `jobId` que da 404 y
    sin forma de saber si la operación terminó.

22. **Migraciones por `try/catch`.** `database.ts:76-92` ejecuta `ALTER TABLE` y traga cualquier
    error, incluidos los reales. No hay tabla de versión de esquema ni forma de saber en qué
    revisión está una instalación.

23. **`getZombieCount` es un falso positivo estructural.** `ps aux | grep defunct` cuenta también
    procesos cuya línea de comando contiene esa palabra (`services/pipeSources.ts:404`).

24. **Confirmaciones inconsistentes.** `views/Dashboard.vue` usa `confirm()` nativo para acciones
    destructivas (reinstalación limpia, desinstalación) mientras existe `ConfirmDialog.vue`.

#### Calidad y proceso — P2

25. **CI solo en tags.** `.github/workflows/release.yml` corre `on: push: tags`. No hay job de
    test, lint ni typecheck en PR o en `main`.
26. **Cobertura testimonial.** 13 tests sobre `snapConfigEdit.ts` y un helper de `system.ts`.
    Cero tests de rutas, servicios o frontend (~13.000 LOC).
27. **Sin linter ni formateador.** No existe configuración de ESLint ni Prettier.
28. **Vistas monolíticas.** `ServerConfig.vue` 1546 líneas, `PipeSources.vue` 853,
    `Dashboard.vue` 583, `Routing.vue` 572. Sin primitivas de formulario compartidas.
29. **Sin tipos compartidos.** Cliente y servidor definen sus formas por separado; los stores
    usan `any` de forma generalizada.
30. **Licencia inconsistente.** El README declara MIT, `server/package.json` dice ISC y **no
    existe fichero LICENSE**. No hay `SECURITY.md`, `CONTRIBUTING.md` ni plantillas de issue.

---

## 3. Principios de diseño de la refactorización

1. **El privilegio se declara, no se hereda.** Toda operación que necesite root pasa por una
   lista blanca explícita; nada se ejecuta porque "el proceso resultó ser root".
2. **Nunca se construyen comandos con concatenación de strings.** `execFile`/`spawn` con array
   de argumentos, siempre.
3. **Los datos de entrada se validan en el borde**, con un esquema, una sola vez, y el resto del
   código asume tipos correctos.
4. **Las escrituras a `/etc` son atómicas y reversibles**: temp + `fsync` + `rename`, con copia
   previa y validación sintáctica antes de aplicar.
5. **El estado se empuja, no se sondea.** WebSocket con snapserver, SSE hacia el navegador.
6. **Un solo sistema de diseño**, con tokens reales, que funcione en claro y oscuro y sin
   internet.
7. **Compatibilidad hacia atrás obligatoria.** Existen instalaciones v0.2.x/v0.3.0 en producción;
   toda migración debe ser automática e idempotente.

---

## 4. Arquitectura objetivo

### 4.1 Ejecución privilegiada — `server/src/platform/`

Se sustituye el patrón actual (`execAsync` con strings + `SUDO` implícito) por una capa única:

```
platform/
  exec.ts          // run(cmd: string, args: string[]) -> nunca shell
  privileged.ts    // catálogo cerrado de acciones root permitidas
  systemd.ts       // start/stop/enable/disable/status/logs, unidad validada contra patrón
  apt.ts           // install/remove/upgrade de un set fijo de paquetes
  files.ts         // writeFileAtomic, installFile(mode, owner), readTextFile
```

- `privileged.ts` expone funciones nombradas (`systemctlStart(unit)`, `installUnitFile(name, content)`,
  `aptInstall(pkg)`), no un "ejecuta esto".
- Cada unidad/paquete se valida contra un patrón (`/^[a-z0-9@._-]+$/`) **y** contra la lista de
  entidades que el propio manager gestiona.
- El instalador genera `/etc/sudoers.d/snapcast-manager` con **comandos concretos** (`NOPASSWD`
  solo para `/usr/bin/systemctl`, `/usr/bin/apt-get`, el helper de instalación de ficheros), de
  modo que el servicio pueda correr como usuario dedicado `snapmanager` y no como root.
- La unidad systemd del manager gana `NoNewPrivileges=yes`, `PrivateTmp=yes`,
  `ProtectSystem=strict`, `ProtectHome=yes` y `ReadWritePaths=` explícito.

### 4.2 Validación y contrato de API — `server/src/schemas/` + `shared/`

- Un paquete `shared/` (o `server/src/types` reexportado por Vite alias) con las interfaces de
  request/response usadas por ambos lados.
- Zod (única dependencia nueva del backend) para validar body/params/query en un middleware
  `validate(schema)`.
- Middleware de errores central: tipo de error → status + código estable (`SNAP_CONFIG_LOCKED`,
  `UNIT_NOT_MANAGED`…). El mensaje interno va al log; el cliente recibe código + mensaje seguro.

### 4.3 Estado en vivo — `server/src/services/snapcastLive.ts`

- Cliente WebSocket persistente contra `ws://127.0.0.1:1780/jsonrpc`, con reconexión exponencial.
- Estado de snapserver cacheado en memoria y actualizado por notificaciones
  (`Client.OnConnect`, `Group.OnStreamChanged`, `Stream.OnUpdate`, …).
- `GET /api/events` (SSE) emite al navegador: estado snapcast, estado de servicios, progreso de
  jobs y estado de pipes.
- El frontend elimina los cinco `setInterval` y consume un único stream; polling queda solo como
  degradación si SSE falla.

### 4.4 Jobs persistentes

- Tabla `jobs` en SQLite (id, label, status, log, started_at, finished_at, exit_code).
- Los jobs sobreviven al reinicio; los que quedaron `running` se marcan `interrupted` al arrancar.
- El log se transmite por SSE en vez de sondearse.

### 4.5 Migraciones

- Tabla `schema_migrations`, ficheros numerados en `server/src/database/migrations/`, ejecución
  transaccional y ordenada, con log claro. Se retira el patrón `try { ALTER TABLE } catch {}`.

### 4.6 Sistema de diseño — `client/src/styles/`

- `@theme` de Tailwind v4 con los tokens reales (`--color-brand-primary`, `--color-surface`,
  `--color-border`, escalas de texto), y borrado de `tailwind.config.js` o adición explícita de
  `@config` (se elige `@theme`, que es el camino nativo de v4).
- Paleta con pares claro/oscuro para **cada** token; ninguna clase `text-white` sin variante.
- Inter y Material Symbols autoalojados en `client/public/fonts/` (subset), sin peticiones a CDN.
- Primitivas compartidas en `client/src/components/ui/`: `Button`, `Input`, `Select`, `Toggle`,
  `Badge`, `Modal`, `EmptyState`, `Skeleton`, `Section`. Las vistas monolíticas se recomponen
  sobre ellas.

### 4.7 UX

- **Jerarquía de navegación**: hoy hay dos niveles arbitrarios (nav primaria + menú "System" con
  seis entradas heterogéneas). Se reorganiza por tarea: *Audio* (Matriz, Fuentes, Zonas),
  *Sistema* (Paquetes, Servicios, Logs), *Configuración* (snapserver.conf, Herramientas),
  *Seguridad* (Acceso, Snapshots).
- **Estados explícitos** en cada vista: cargando (skeleton), vacío (con acción), error (con
  reintento), sin permisos, servicio no instalado. Hoy la mayoría solo tiene "datos" y "toast".
- **Acciones destructivas**: siempre `ConfirmDialog`, con nombre de la entidad escrito por el
  usuario cuando la acción borra datos (reinstalación limpia, borrado de snapshot).
- **Matriz de audio**: además del arrastre, selección por teclado (foco en fuente → Enter →
  flechas → Enter en zona), menú contextual por zona y modo lista para móvil. Roles ARIA de
  `listbox`/`option` y `aria-live` para anunciar el cambio de ruta.
- **Onboarding**: tras el wizard, un asistente de tres pasos (instalar snapserver → crear la
  primera fuente → asignar la primera zona) en lugar de un dashboard vacío.
- **Accesibilidad objetivo**: WCAG 2.1 AA — contraste, foco visible, todo botón de solo icono con
  `aria-label`, navegación completa por teclado, `prefers-reduced-motion` respetado (hoy hay
  transiciones de 500 ms en el body).

---

## 5. Fuera de alcance

- Reescritura del backend a otro framework o lenguaje.
- Multiusuario con roles granulares (se deja preparado el campo `role`, no se implementa).
- Gestión remota de varios hosts desde una sola instancia.
- Reproductor nativo (sigue delegado a myMPD).
- HTTPS terminado por la propia app (se documenta el reverse proxy).

---

## 6. Criterios de aceptación globales

1. Ningún `exec()` con string interpolado queda en `server/src` (verificable con grep en CI).
2. Un test de seguridad por cada vector del §2.1 (1–6), que falle contra el código actual.
3. `vite build` produce CSS con las reglas `brand-*`; test de regresión que falla si no.
4. La app funciona completamente sin acceso a internet salvo para instalar paquetes.
5. Modo claro y oscuro pasan contraste AA en todas las vistas.
6. CI en cada PR: typecheck + lint + tests de servidor y cliente + build.
7. Cobertura ≥ 70 % en `server/src/services` y `server/src/routes`.
8. El servicio corre como usuario `snapmanager` (no root) en una instalación nueva, y una
   instalación existente migra sin intervención manual.
9. Una vista abierta durante 10 minutos genera ≤ 1 conexión SSE y 0 peticiones de polling.
10. `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md` presentes y coherentes con el README.
