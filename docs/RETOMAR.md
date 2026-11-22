# Punto de retome

**Estado al 21/11/2026:**
- Carteles QR dinámicos listos para imprimir: «Mirá nuestra carta · Mesa N» y «Puntuanos en Google». Los destinos se cambian en **Configuración → Códigos QR** sin reimprimir.
- Pedidos por QR autorizados por el mozo, combos con elección, totales unificados, registro de ingresos y eventos en vivo filtrados por rol (con corte inmediato al revocar sesiones).
- La app queda corriendo en http://localhost:4100 con **`npm run start:local`** (datos en `data/local`, que las pruebas no tocan). Clave de todos: `prueba1234`, PIN 1234. Copia previa a la separación: `backups/antes-de-separar-4100`.

**Dónde se editan los enlaces:**
- Destino de cada QR de mesa y enlace de Google: **Configuración → Códigos QR** (dueño o encargado).
- Descargar carteles: ahí mismo, o «Descargar PNG» en **Configuración → Mesas y sectores**.

**Cómo probar el pedido por QR:**
1. Mozo (`mozo1@esquina.test`): Salón → Mesa 2 → Abrir mesa → **Habilitar pedidos por QR**. Aparece un código de 6 números.
2. Cliente: en otro navegador o celular (en el mismo Wi-Fi), escaneá el cartel de la mesa 2 o abrí «Probar». Armá el carrito → «Revisar y pedir» → ingresá el código → **Enviar pedido**.
3. El mozo ve el aviso con «Ver pedido»; cocina y barra reciben su parte.

**Corrida final, todo en verde:** `tsc`, `npm run lint`, build, 88 tests de integración, 13 de Playwright en el puerto 4300 con `data/test-e2e`, `npm audit` en 0. Detalle en `docs/PRUEBAS.md`.

**Cómo re-verificar sin tocar el 4100:**
```
npm run build && npm test && npx playwright test
```

**Próximo paso concreto:**
1. Imprimir los carteles de prueba y escanearlos con celulares reales (lista en «Requieren equipo físico» de `docs/PRUEBAS.md`).
2. Elegir hosting y dominio; configurar `PUBLIC_URL` y `TRUST_PROXY`, y descargar los carteles definitivos (`docs/INSTALACION.md` → «Carteles definitivos»).
3. Cargar el enlace real de reseñas de Google en Códigos QR.
