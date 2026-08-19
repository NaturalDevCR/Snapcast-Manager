# Plan de Profesionalización — Snapcast Manager

> **Para agentes:** SUB-SKILL REQUERIDA: usar `superpowers:subagent-driven-development` o
> `superpowers:executing-plans` para ejecutar etapa por etapa. Cada tarea usa checkbox (`- [ ]`).

**Spec de referencia:** [`2026-08-18-professional-hardening-design.md`](../specs/2026-08-18-professional-hardening-design.md)
**Base:** v0.3.0 (`63a65d3`)
**Stack:** Node 22 + Express 5 + TypeScript + better-sqlite3 (backend); Vue 3 + Pinia + Tailwind v4 (frontend); `node:test`.

## Restricciones globales

- **Compatibilidad hacia atrás obligatoria.** Hay instalaciones v0.2.x/v0.3.0 en producción.
  Toda migración de datos, unidades systemd o rutas debe ser automática e idempotente.
- **Una rama por etapa**, un PR por etapa, release al final de cada etapa (`0.4.0` … `0.9.0`).
- **TDD en todo lo que toque seguridad o parsing.** El test que reproduce el fallo se escribe primero.
- **Dependencias nuevas permitidas:** `zod`, `ws`, `helmet`, `pino` (backend); ESLint + Prettier
  y Vitest + `@vue/test-utils` (dev). Nada más sin justificar en el PR.
- Verificación por etapa: `cd server && npm test && npm run build` y `cd client && npm run build`.

---

## Etapa 0 — Red de seguridad (prerequisito, ~2 días)

Sin esto, cada etapa siguiente es una apuesta. No introduce cambios funcionales.

- [ ] **0.1 CI en cada push y PR.** Nuevo `.github/workflows/ci.yml`: matriz Node 22/24,
      `server: npm ci && npm run build && npm test`, `client: npm ci && npm run build`.
      Requerido para hacer merge a `main`.
- [ ] **0.2 ESLint + Prettier** en raíz, compartido por `server/` y `client/`
      (`typescript-eslint`, `eslint-plugin-vue`). Script `npm run lint` y job en CI.
      Primera pasada solo con reglas que ya se cumplen + `--max-warnings` congelado.
- [ ] **0.3 Vitest en el cliente** con un test de humo por vista (monta y no lanza).
- [ ] **0.4 Regla de CI anti-inyección:** grep que falla si aparece `exec(` con template literal
      en `server/src` fuera de `platform/`. Se añade ya, en modo *warning*, y pasa a *error* al
      cerrar la Etapa 1.
- [ ] **0.5 Higiene de repo:** añadir `LICENSE` (MIT, coherente con el README), corregir
      `"license"` en `server/package.json` y `client/package.json`, añadir `SECURITY.md`
      (canal de reporte y política de divulgación), `CONTRIBUTING.md` y plantillas de issue/PR.
      Borrar el worktree obsoleto `.claude/worktrees/kind-carson`.

**Aceptación:** un PR con un test roto no se puede mergear.

---

## Etapa 1 — Seguridad crítica (~1 semana) → `v0.4.0`

Cierra los vectores del §2.1 de la spec. **Es la etapa bloqueante: nada más debería publicarse antes.**

### 1.1 Capa de ejecución sin shell

- [ ] Crear `server/src/platform/exec.ts` con `run(bin: string, args: string[], opts)` sobre
      `execFile`, sin shell, con timeout y `maxBuffer` explícitos.
- [ ] Crear `server/src/platform/systemd.ts`: `start/stop/restart/enable/disable/isActive/logs`,
      validando el nombre de unidad contra `/^[a-z0-9@._-]+$/` **y** contra el conjunto de
      unidades que el manager gestiona (prefijos `snapclient-manager-`, `snapcast-radio-`, y la
      lista fija `snapserver|snapclient|mpd|mympd|shairport-sync|nqptp`).
- [ ] Crear `server/src/platform/apt.ts` con una lista blanca cerrada de paquetes.
- [ ] Crear `server/src/platform/files.ts`: `writeFileAtomic` (temp en el mismo filesystem +
      `fsync` + `rename`) e `installPrivilegedFile(path, content, mode)` usando `mkdtemp` con
      permisos 0700, nunca rutas fijas en `/tmp`.
- [ ] Migrar `services/system.ts`, `services/pipeSources.ts`,
      `services/snapclientInstances.ts`, `services/watchdog.ts`, `services/backup.ts` y
      `routes/tools.ts` a esta capa. Los scripts multi-paso de instalación
      (`installShairportSync`, `installSnapCtrl`) pasan a ficheros `.sh` versionados en
      `server/scripts/`, ejecutados con `bash <script> <args>` sin interpolación.

### 1.2 Cierre de los vectores concretos (TDD)

- [ ] **Test primero** para cada uno; deben fallar contra el código actual:
      `existingServiceName` con `;`, `:id` de instancia con `%3B`, registro de script apuntando a
      `/etc/sudoers.d/x`, unidad systemd arbitraria vía `PUT /pipe-sources/:id/config`.
- [ ] `POST /api/pipe-sources/adopt`: `existingServiceName` debe existir en el listado de unidades
      descubiertas por `discover()`; se rechaza cualquier otra cosa.
- [ ] Instancias snapclient: resolver el `id` contra la base de datos **antes** de tocar el
      sistema; 404 si no existe. Cambiar el generador a `randomUUID()` y migrar los `inst-*`
      existentes conservando su nombre de unidad.
- [ ] `POST /api/tools/scripts`: restringir el registro a un directorio propio
      (`/var/lib/snapcast-manager/scripts`), con `path.resolve` + comprobación de prefijo y
      rechazo de symlinks. Migrar rutas ya registradas fuera de ese directorio a **solo lectura**,
      avisando en la UI.
- [ ] `PUT /api/pipe-sources/:id/config`: validar la unidad con `systemd-analyze verify` sobre el
      fichero temporal antes de instalarla; rechazar directivas peligrosas fuera de `[Service]`
      esperadas; guardar la versión previa y ofrecer rollback en la UI.
- [ ] FIFOs de pipe sources: mover de `/tmp` a `/run/snapcast-manager/` con modo `0660` y grupo
      `audio`; migración automática que reescribe unidades y `snapserver.conf`.
- [ ] Quitar `--no-check-certificate` de `installSnapCtrl` y verificar el `.zip` descargado
      (tamaño + hash del asset según la API de GitHub).

### 1.3 Modelo de privilegios

- [ ] Instalador: crear usuario de sistema `snapmanager` (grupo `audio`), instalar en
      `/opt/snapcast-manager` con propiedad de ese usuario, y escribir
      `/etc/sudoers.d/snapcast-manager` con comandos concretos (`systemctl`, `apt-get`, el helper
      de instalación de ficheros), validado con `visudo -c`.
- [ ] Unidad `snapmanager.service`: `User=snapmanager`, `NoNewPrivileges=yes`, `PrivateTmp=yes`,
      `ProtectSystem=strict`, `ProtectHome=yes`, `ReadWritePaths=/opt/snapcast-manager/data
      /etc/snapserver.conf /etc/snapserver.conf.d /etc/snapcast-manager /run/snapcast-manager`.
- [ ] `.env` con `chmod 600` y propiedad `snapmanager`.
- [ ] **Migración de instalaciones existentes**: el instalador detecta `User=root`, crea el
      usuario, mueve datos, ajusta permisos y reinicia. Idempotente y con rollback si falla.
- [ ] Comprobación de arranque: si el proceso es UID 0, registrar un aviso destacado y mostrarlo
      en la UI hasta que se migre.

### 1.4 Autenticación y superficie HTTP

- [ ] Longitud mínima de contraseña (12 caracteres) validada en servidor y reflejada en
      `Setup.vue` y `Security.vue` con medidor de fuerza.
- [ ] Rate limit persistido en SQLite (sobrevive reinicios) y aplicado también a
      `/auth/setup` y `/auth/change-password`.
- [ ] `helmet` con CSP estricta (sin CDN, ver Etapa 2), `express.json({ limit: '1mb' })`,
      timeout de request.
- [ ] Middleware de errores central: código estable al cliente, detalle solo al log.
      Ninguna respuesta HTTP vuelve a contener un comando de shell.
- [ ] Cambio de contraseña invalida los tokens previos (columna `token_version` en `users`,
      incluida en el JWT y comprobada en `authenticateToken`).
- [ ] `POST /auth/logout` + almacenamiento del token en memoria del store con `sessionStorage`
      solo para el refresco de página; documentar el riesgo residual de XSS.

**Aceptación:** los cuatro tests de inyección pasan; la regla de CI del punto 0.4 pasa a *error*;
una instalación nueva corre como `snapmanager`; `SECURITY.md` documenta el modelo de amenaza.

---

## Etapa 2 — Reparación del sistema de diseño (~4 días) → `v0.5.0`

Alto impacto visible, riesgo bajo, independiente de la Etapa 1.

- [ ] **2.1 Tokens reales en Tailwind v4.** Sustituir `tailwind.config.js` por un bloque `@theme`
      en `client/src/style.css` que declare `--color-brand-primary`, `--color-brand-bg`,
      `--color-surface`, `--color-border`, `--color-text`, `--color-text-muted`, `--color-accent`
      y las variantes de estado. Borrar el config v3.
- [ ] **2.2 Test de regresión de CSS:** script que construye y falla si el CSS resultante no
      contiene `.bg-brand-primary`. Añadir al job de CI.
- [ ] **2.3 Paridad claro/oscuro.** Definir cada token en ambos esquemas; eliminar `text-white`
      y `bg-white/5` sin variante de `Layout.vue` y de todas las vistas; auditar contraste AA.
- [ ] **2.4 Autoalojar tipografía e iconos.** Subset de Inter (400/600/800) y de Material Symbols
      con los glifos realmente usados, en `client/public/fonts/`, con `font-display: swap`.
      Quitar los `<link>` a Google Fonts de `index.html`. La app debe verse idéntica sin internet.
- [ ] **2.5 Primitivas UI** en `client/src/components/ui/`: `Button` (variantes/estados/loading),
      `Input`, `Select`, `Toggle`, `Badge`, `Modal`, `EmptyState`, `Skeleton`, `SectionHeader`,
      `ConfirmDestructive`. Con tests de montaje.
- [ ] **2.6 `prefers-reduced-motion`** respetado; bajar la transición global de 500 ms a 150 ms.
- [ ] **2.7 Favicon y branding** propios (hoy es `vite.svg`), más `manifest.webmanifest` para
      instalación como PWA en móvil (el uso real es desde el teléfono en la LAN).

**Aceptación:** capturas antes/después de las 11 vistas en claro y oscuro; auditoría de contraste
sin fallos; build sin peticiones externas.

---

## Etapa 3 — Arquitectura backend (~1,5 semanas) → `v0.6.0`

- [ ] **3.1 Tipos compartidos.** `shared/types.ts` (o `server/src/types` con alias de Vite) con
      las formas de request/response; los stores del cliente dejan de usar `any`.
- [ ] **3.2 Validación con Zod** y middleware `validate(schema)` en las 9 rutas. Sustituye los
      `if (!x) return 400` dispersos.
- [ ] **3.3 Escrituras atómicas y con bloqueo** de `/etc/snapserver.conf`, `snapserver.conf.base`
      y `mpd.conf`: temp + `fsync` + `rename`, lock de fichero, copia `.bak` rotada y validación
      sintáctica previa con `SnapConfigParser`. Test: escritura concurrente no corrompe.
- [ ] **3.4 Migraciones versionadas.** Tabla `schema_migrations` + ficheros numerados en
      `server/src/database/migrations/`. Retirar el patrón `try { ALTER TABLE } catch {}`
      preservando el estado de las bases existentes.
- [ ] **3.5 Jobs persistentes** en SQLite; los `running` huérfanos se marcan `interrupted` al
      arrancar; el log se guarda y se puede consultar tras un reinicio.
- [ ] **3.6 Cliente WebSocket de snapserver** (`services/snapcastLive.ts`) con reconexión
      exponencial y caché de estado alimentada por notificaciones.
- [ ] **3.7 `GET /api/events` (SSE)** que emite estado de snapcast, servicios, pipes y jobs.
      Un único intervalo interno en el servidor (5 s) sustituye a N clientes sondeando.
- [ ] **3.8 Watchdog bajo demanda.** Arrancar el temporizador solo si hay watchdogs con
      `autoKillDuplicates`; parar cuando no queden. `ensureConfig()` deja de caer en silencio a un
      directorio alternativo: si no puede escribir, es un error visible.
- [ ] **3.9 Sustituir `ps aux | grep defunct`** por lectura de `/proc/*/stat` filtrando estado `Z`.
- [ ] **3.10 Colisión de slugs.** Índice único sobre el slug en `radio_pipe_streams`, rechazo con
      mensaje claro en la UI, y nombre vacío/solo-símbolos inválido. Migración que detecta
      colisiones existentes y las renombra avisando.
- [ ] **3.11 Logging estructurado** con `pino`, niveles por entorno, sin secretos, y rotación
      delegada a journald.
- [ ] **3.12 Apagado ordenado**: `SIGTERM` cierra SSE, WebSocket, el temporizador del watchdog y
      la base de datos.

**Aceptación:** cobertura ≥ 70 % en `services/` y `routes/`; test de corrupción concurrente;
prueba manual de reinicio a mitad de instalación con el job recuperado.

---

## Etapa 4 — UX y accesibilidad (~1,5 semanas) → `v0.7.0`

- [ ] **4.1 Consumo de SSE en el frontend.** Eliminar los cinco `setInterval` de
      `Dashboard`, `Routing`, `Watchdogs`, `Logs` y `PipeSources`. Reconexión automática y
      degradación a polling solo si SSE falla. Indicador de "en vivo / reconectando".
- [ ] **4.2 Reorganización de la navegación** en cuatro áreas (Audio, Sistema, Configuración,
      Seguridad), con rutas antiguas redirigidas.
- [ ] **4.3 Estados completos por vista:** skeleton de carga, vacío con acción primaria, error con
      reintento, y estado "servicio no instalado" con enlace a instalarlo.
- [ ] **4.4 Matriz de audio accesible.** Selección por teclado (foco en fuente → Enter → flechas →
      Enter en zona), roles `listbox`/`option`, `aria-live` anunciando la asignación, y modo lista
      en móvil (< 640 px) en lugar del arrastre.
- [ ] **4.5 Acciones destructivas** unificadas en `ConfirmDialog`; escribir el nombre de la entidad
      para reinstalación limpia, borrado de snapshot y desinstalación. Fin de `confirm()` nativo.
- [ ] **4.6 Descomponer las vistas monolíticas**: `ServerConfig.vue` (1546 líneas) en
      `ConfigEditor` + `ConfigSectionForm` + `SourceList` + `SegmentManager`;
      `PipeSources.vue` (853) en lista, formulario y panel de diagnóstico; `Dashboard.vue` (583)
      en `PackageCard` + `ServiceCard` + `SystemOverview`. Ninguna vista por encima de 300 líneas.
- [ ] **4.7 Onboarding de tres pasos** tras el wizard: instalar snapserver → crear la primera
      fuente → asignar la primera zona, con progreso persistido.
- [ ] **4.8 Auditoría WCAG 2.1 AA**: `aria-label` en los ~150 botones de solo icono, foco visible,
      orden de tabulación, contraste. Objetivo: cero errores críticos en axe.
- [ ] **4.9 Revisión de microcopy** en inglés (mensajes de error accionables, no `err.message`),
      y extracción de todas las cadenas a `client/src/locales/en.json` preparando i18n.
- [ ] **4.10 Móvil.** El uso real es desde el teléfono: revisar tamaños de toque (≥ 44 px), el
      editor de configuración en pantalla pequeña y el menú "System" desplegable.

**Aceptación:** una vista abierta 10 min genera 1 conexión SSE y 0 peticiones de polling;
axe sin errores críticos; recorrido completo por teclado grabado.

---

## Etapa 5 — Fiabilidad y operación (~1 semana) → `v0.8.0`

- [ ] **5.1 Health checks.** `GET /api/health` (liveness) y `/api/health/detail` (snapserver
      alcanzable, config parseable, disco, permisos), con panel en la UI.
- [ ] **5.2 Instalación/actualización segura.** Toda instalación de paquete precedida de snapshot
      automático; si el servicio no arranca tras la operación, rollback automático y aviso.
      (Hoy `safeBackup` existe pero su fallo se ignora en silencio.)
- [ ] **5.3 Snapshots reales.** Incluir la base de datos del manager, `/etc/snapserver.conf*`,
      unidades gestionadas, `mpd.conf` y `/etc/snapcast-manager`. Restauración verificada por
      test de integración en contenedor.
- [ ] **5.4 Verificación de descargas** de GitHub (tamaño y hash del asset) antes de `dpkg -i`.
- [ ] **5.5 Autodiagnóstico** en la UI: detecta config no gestionada, unidades huérfanas, FIFOs
      sin productor, snapserver caído, puertos ocupados; cada hallazgo con acción de reparación.
- [ ] **5.6 Tests de integración en contenedor.** Imagen Debian con systemd donde se prueban
      instalación, creación de pipe source, adopción y restauración. Job de CI nocturno.
- [ ] **5.7 Métricas mínimas locales** (sin telemetría externa): uptime, jobs ejecutados, errores
      por endpoint, visibles en `/api/health/detail`.

---

## Etapa 6 — Producto y publicación (~4 días) → `v0.9.0` → `v1.0.0`

- [ ] **6.1 Documentación.** README reescrito (qué es, para quién, arquitectura, modelo de
      seguridad, requisitos), `docs/installation.md`, `docs/security.md` (por qué necesita sudo y
      qué exactamente), `docs/troubleshooting.md`, `docs/api.md` generado desde los esquemas Zod.
- [ ] **6.2 Guía de despliegue seguro:** reverse proxy con TLS, exposición solo en LAN, aviso
      explícito de que myMPD (puerto 8080) queda fuera del login del manager.
- [ ] **6.3 i18n** con `vue-i18n`: inglés y español (el proyecto es de Costa Rica y la base de
      usuarios es bilingüe).
- [ ] **6.4 Release reproducible:** el workflow publica checksums, `CHANGELOG.md` generado desde
      commits convencionales, y el instalador verifica el hash del `.zip` antes de instalar.
- [ ] **6.5 Migración v0.x → v1.0** probada desde una instalación real de v0.2.2 y de v0.3.0.
- [ ] **6.6 Repaso final**: `/code-review high` sobre el diff acumulado y auditoría de
      dependencias (`npm audit`).

---

## Orden y paralelización

```
Etapa 0  ──┬─→ Etapa 1 (seguridad, bloqueante)  ──┬─→ Etapa 3 (backend)  ──┬─→ Etapa 5 ─→ Etapa 6
           └─→ Etapa 2 (diseño, independiente) ───┘                        │
                                                   Etapa 4 (UX) ───────────┘
```

- Las Etapas 1 y 2 pueden ir en paralelo (tocan lados opuestos del código).
- La Etapa 4 depende de la 2 (primitivas UI) y de la 3 (SSE).
- **Nada se publica como release público hasta cerrar la Etapa 1.**

## Estimación

| Etapa | Esfuerzo | Riesgo | Impacto |
|---|---|---|---|
| 0 — Red de seguridad | 2 días | Bajo | Alto (habilita el resto) |
| 1 — Seguridad crítica | 1 semana | **Alto** (toca ejecución privilegiada) | Crítico |
| 2 — Sistema de diseño | 4 días | Bajo | Alto y visible |
| 3 — Backend | 1,5 semanas | Medio | Alto |
| 4 — UX y a11y | 1,5 semanas | Medio | Alto |
| 5 — Fiabilidad | 1 semana | Medio | Medio-alto |
| 6 — Producto | 4 días | Bajo | Medio |

**Total: ~6–7 semanas de trabajo enfocado.**

## Si solo hay tiempo para tres cosas

1. **Etapa 1.2** — los cuatro vectores de inyección y escritura arbitraria como root.
2. **Etapa 2.1–2.4** — tokens de Tailwind, paridad claro/oscuro y activos autoalojados:
   arregla lo que todo usuario ve, en un día de trabajo.
3. **Etapa 0.1** — CI en cada PR, para que nada de lo anterior se rompa otra vez.
