# PostgreSQL — operación de GPG Seguros

PostgreSQL es el único motor soportado por la aplicación. Las migraciones de
`migrations/` son la única fuente de verdad del esquema; una migración aplicada
nunca se modifica, se agrega una nueva.

## Primera instalación

1. Crear una base y un usuario PostgreSQL exclusivos para la aplicación.
2. Copiar `.env.example` a `.env` y completar la conexión.
3. Ejecutar `npm run db:preflight`.
4. Ejecutar `npm run db:migrate`.
5. Verificar con `npm run db:doctor`.
6. Iniciar con `npm start`.

El servidor no escucha tráfico si la conexión o una migración fallan. En
serverless, cada arranque frío usa un bloqueo asesor de PostgreSQL para que una
sola instancia aplique las migraciones.

## Actualización de una instalación existente

Antes de desplegar código nuevo:

1. Generar y verificar un respaldo.
2. Ejecutar `npm run db:preflight` contra la base destino.
3. Corregir cualquier conteo marcado como `REVISAR` sin borrar historial.
4. Ejecutar `npm run db:migrate`.
5. Ejecutar `npm run db:doctor`.
6. Desplegar la aplicación y verificar `GET /api/health`.

Cada migración guarda nombre, checksum, fecha y duración en
`schema_migrations`. Si alguien edita una migración ya aplicada, el arranque se
detiene y exige crear una migración nueva.

## Pruebas

`npm test` no abre ninguna conexión. Valida utilidades, estructura de las
migraciones, restricciones esperadas y ausencia de rutas SQLite.

Las pruebas de integración requieren una base descartable diferente:

```text
TEST_DATABASE_URL=postgresql://.../gpg_seguros_test
npm run test:db
```

La aplicación ignora `DATABASE_URL` cuando `NODE_ENV=test`; por eso la suite de
integración no puede tocar accidentalmente la base habitual.

## Respaldo y recuperación

Para una agencia, la política mínima recomendada es:

- respaldo automático diario cifrado;
- retención diaria de 30 días y mensual de 12 meses;
- recuperación a un punto en el tiempo (PITR) cuando el proveedor la ofrezca;
- una restauración de prueba por trimestre;
- copia en una región o cuenta diferente;
- alerta cuando un respaldo o restauración de prueba falla.

Ejemplo de respaldo lógico manual:

```text
pg_dump --format=custom --no-owner --file=gpg_YYYYMMDD.dump "$DATABASE_URL"
```

La restauración siempre se ensaya primero sobre una base vacía distinta. No se
restaura directamente sobre producción.

## Integridad y auditoría

- Los importes usan `NUMERIC`, nunca coma flotante.
- Fechas y vencimientos usan la zona `America/Argentina/Buenos_Aires`.
- Las claves foráneas evitan borrados en cascada del historial.
- Clientes, pólizas y cotizaciones se archivan mediante estados; sus endpoints
  de baja no eliminan físicamente los registros.
- `auditoria_eventos` registra INSERT, UPDATE y DELETE con usuario y request.
- La auditoría es append-only: la aplicación no puede editarla ni borrarla.
- `pg_trgm`, cuando está permitido por el proveedor, acelera búsquedas parciales.

Los adjuntos no deben persistirse en el disco efímero de un proveedor serverless.
La base debe guardar únicamente metadatos y una clave de objeto; los archivos
deben vivir en almacenamiento privado con URLs firmadas.

## Evolución multiempresa

Este esquema representa una instalación por agencia. Para ofrecer una única
base compartida entre agencias se requiere una migración explícita con
`organizacion_id`, restricciones compuestas y políticas Row Level Security. No
se debe simular multi-tenancy filtrando solamente en el frontend.
