# Evolve API

Backend de la app Android **Evolve**: catálogo de ejercicios, autenticación,
perfil, planes de entrenamiento, registro de series y progreso.

- Node 22 + Express 5 + TypeScript (ESM)
- PostgreSQL con SQL plano (sin ORM)
- JWT de acceso (15 min) + refresh token opaco rotativo (30 días)
- Catálogo de 1.324 ejercicios en memoria, con imágenes y GIFs servidos localmente

## Inicio rápido

```bash
npm install
docker compose up -d          # PostgreSQL local en :5432
copy .env.example .env        # editar JWT_SECRET si hace falta
npm run build
npm run db:migrate
npm run dev                   # http://localhost:3000
```

El catálogo se carga desde `data/exercises.json` al arrancar (~170 ms, ~50 MB de
heap). No requiere base de datos para funcionar: solo las rutas de usuario la usan.

### Variables de entorno

| Variable | Por defecto | Notas |
| --- | --- | --- |
| `PORT` | `3000` | Render la inyecta |
| `DATABASE_URL` | Postgres local | En Neon usar la connection string *pooled* con `?sslmode=require` |
| `DATABASE_POOL_MAX` | `5` | Mantener bajo en Neon free |
| `JWT_SECRET` | secreto de desarrollo | **Obligatorio y de 32+ caracteres en producción** |
| `ACCESS_TOKEN_TTL_SECONDS` | `900` | 15 minutos |
| `REFRESH_TOKEN_TTL_DAYS` | `30` | |
| `CORS_ORIGIN` | `*` | Lista separada por comas si se restringe |
| `MEDIA_BASE_URL` | vacío | Solo si los medios se mueven a un CDN |

## API

Base: `/api/v1`. Errores con la forma
`{ "error": { "code": "...", "message": "...", "details": ... } }`.
Las rutas protegidas esperan `Authorization: Bearer <accessToken>`.

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/healthz` | Health check |
| GET | `/api/v1/meta` | Totales y valores de filtro del catálogo |
| GET | `/api/v1/exercises` | Listado con `search`, `bodyPart`, `equipment`, `target`, `muscleGroup`, `lang`, `limit`, `offset` |
| GET | `/api/v1/exercises/:id` | Detalle con instrucciones y pasos (`?lang=es`) |
| POST | `/api/v1/auth/register` | Crear usuario y emitir tokens |
| POST | `/api/v1/auth/login` | Iniciar sesión |
| POST | `/api/v1/auth/refresh` | Rotar refresh token |
| POST | `/api/v1/auth/logout` | Revocar refresh token |
| GET / PATCH | `/api/v1/profile` | Perfil y preferencias |
| GET / POST | `/api/v1/plans` | Listar / crear planes |
| GET / PUT / DELETE | `/api/v1/plans/:id` | Detalle / reemplazar / borrar |
| POST | `/api/v1/plans/:id/activate` | Activar plan |
| GET | `/api/v1/workouts/today` | Día de hoy según la zona horaria del usuario |
| GET / POST | `/api/v1/workouts` | Historial / iniciar entrenamiento |
| GET | `/api/v1/workouts/:id` | Detalle con series |
| POST | `/api/v1/workouts/:id/sets` | Registrar o corregir una serie |
| POST | `/api/v1/workouts/:id/finish` | Finalizar |
| GET | `/api/v1/progress/summary` | Racha, entrenamientos y volumen de la semana, PRs nuevas |
| GET | `/api/v1/progress/volume` | Volumen de lunes a domingo |
| GET | `/api/v1/progress/records` | Mejor serie por ejercicio |

El contrato completo está en [`openapi.yaml`](openapi.yaml).

### Autenticación

1. `register` / `login` devuelven `accessToken` (JWT, 15 min) y `refreshToken`.
2. El refresh token se guarda **hasheado** en `refresh_tokens`; cada `refresh`
   revoca el anterior y emite uno nuevo.
3. `logout` revoca el refresh token enviado.

### Usuarios y datos

- `users.timezone` define qué es "hoy" y "esta semana" (IANA, p. ej.
  `America/Argentina/Buenos_Aires`).
- Récords personales y volumen se derivan de `workout_sets`; no hay tablas
  duplicadas que puedan desincronizarse.
- Un solo plan activo por usuario, garantizado por un índice único parcial.

## Medios

`public/images` y `public/videos` se sirven en `/media/...` con caché de 30 días.
El JSON del dataset referencia `images/0001-....jpg` y `videos/0001-....gif`. La API
devuelve URLs absolutas construidas desde `MEDIA_BASE_URL`, `RENDER_EXTERNAL_URL` o
el host de la petición.

Los listados devuelven `imageUrl` (miniatura) y `gifUrl`. Para no gastar los 5 GB
mensuales del plan free de Render, la app debería mostrar `gifUrl` solo en el
detalle del ejercicio.

**Atribución:** datos del dataset MIT; medios © Gym visual —
https://gymvisual.com/. Ver `data/NOTICE.md` y `data/LICENSE`.

## Tests

```bash
npm test          # catálogo + auth (sin base de datos)
npm run test:db   # integración; requiere TEST_DATABASE_URL
```

## Despliegue en Render + Neon

1. Crear un proyecto en [Neon](https://neon.tech), copiar la connection string
   *pooled* (con `sslmode=require`).
2. Subir el repo a GitHub.
3. En Render: **New → Blueprint**, elegir el repo con `render.yaml`.
4. Cargar `DATABASE_URL` cuando Render la pida. `JWT_SECRET` se genera solo.
5. El arranque ejecuta `npm run db:migrate` y luego `npm start`.

Notas del plan free:

- El servicio se duerme tras 15 minutos sin tráfico; el primer request puede
  tardar ~1 minuto. El cliente Android debería tolerar ese arranque en frío.
- Render free incluye 5 GB/mes de tráfico. Con GIFs de ~90 KB, son ~50.000
  visualizaciones mensuales; si crece, mover los medios a un CDN con
  `MEDIA_BASE_URL`.
- No usar Postgres de Render free: expira a los 30 días. Neon free no expira.

## Estructura

```
src/
  app.ts          middlewares y routers
  server.ts       arranque y cierre ordenado
  migrate.ts      runner de sql/*.sql
  auth.ts         scrypt, JWT, refresh tokens
  catalog.ts      carga y filtros del catálogo
  routes/         auth, profile, exercises, plans, workouts, progress
sql/001_init.sql  esquema
data/             exercises.json + licencias
public/           imágenes y GIFs
test/             tests de catálogo, auth e integración
```
