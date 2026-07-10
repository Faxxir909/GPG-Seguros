# TODO - Performance & UX (GPG Seguros)

## Completado
- [ ] Confirmado: NO se aplicaron cambios reales todavía


## Pendiente (aplicar cambios reales)
1. Debounce en búsquedas
   - Cambiar `keyup` por `input`.
   - Implementar debounce 300-400ms para:
     - `#search-client`
     - `#search-policy`

2. Paginación: listener estable
   - Evitar `addEventListener('pagechange', ..., { once: true })` recreado en cada render.
   - Dejar listener una sola vez y reutilizar.

3. Render de tablas más eficiente
   - Reducir `tbody.innerHTML += ...` en loops.
   - Construir una sola string o `DocumentFragment` y asignar una vez.
   - Aplicar en:
     - renderClientes
     - renderPolicies
     - renderClaimsTable
     - loadClientVehicles
     - loadClientPolicies

4. Carga bajo demanda / skeletons en ficha
   - `openClientDetail()` actualmente dispara 5 calls.
   - Introducir loading por sub-tab y/o lazy-load.

5. Robustez de `apiFetch`
   - Asegurar parse seguro del body de error (no asumir JSON).

## Validación
- [ ] Abrir panel Clientes y probar búsqueda fluida
- [ ] Abrir panel Pólizas y probar filtros fluídos
- [ ] Abrir ficha de cliente y validar que sub-tabs cargan correctamente
- [ ] Validar que no aparecen errores en consola

