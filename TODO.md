# TODO - Duplicación de modelos (autos)

- [x] Confirmar origen del problema (A: siempre por seed / B: solo en BD con seed repetido)
- [ ] Normalizar `modelo` y `version` al sembrar catálogo (`db.js`): trim + colapsar espacios + normalizar case antes de insertar.
- [ ] Asegurar que `UNIQUE(marca, modelo, version)` conserve datos coherentes con normalización.

- [ ] (Si aplica) limpiar/normalizar datos existentes en `catalogo_vehiculos` para evitar duplicados visuales ya cargados.
- [ ] Probar endpoints `/api/brands/:brand/models` y `/api/brands/:brand/models/:model/versions` con la BD actual.
- [ ] Ejecutar arranque del servidor y validar en UI.

