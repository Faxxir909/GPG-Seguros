# TODO - Performance & UX (GPG Seguros)

## Completado
- [x] Skeletons visuales (shimmer) antes de cada petición de datos en todos los módulos (Dashboard, Clientes, Pólizas, Cotizaciones, Siniestros, Agenda, Comisiones).
- [x] Estados vacíos estilizados (`showTableEmpty`) con iconos informativos cuando no hay datos o no hay coincidencias de búsqueda.
- [x] Manejo de errores con botón "Reintentar" (`showTableError`) ante fallas de conexión o API.
- [x] Debounce (300-350ms) en todas las barras de búsqueda y filtros para evitar renders innecesarios.
- [x] Paginación con listener estable sin fugas ni recreaciones continuas.
- [x] Render eficiente de tablas asignando una sola vez al DOM (`innerHTML` unificado).
- [x] Carga perezosa (lazy-loading) bajo demanda por sub-pestaña en la ficha de cliente (`shown.bs.tab`).
- [x] Robustez en `apiFetch` con parseo seguro de respuestas de error.

## Validación
- [x] Abrir panel Clientes y probar búsqueda fluida
- [x] Abrir panel Pólizas y probar filtros fluidos
- [x] Abrir ficha de cliente y validar que sub-tabs cargan correctamente con skeletons
- [x] Validar que no aparecen errores en consola

