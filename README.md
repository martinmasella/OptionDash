# OptionDash by Tinchex Capital

Dashboard estático de estrategias de volatilidad sobre opciones de **GGAL (BYMA)**.
Lee en tiempo real la hoja «Sabro» de un Google Sheet público y arma automáticamente:

1. Straddle vendido (bases ATM)
2. Strangle vendido (≈ ±10 %)
3. Butterfly comprado (cuerpo ATM)
4. Iron Condor vendido (cortos ≈ ±10 %, alas en la siguiente base líquida)

Solo usa contratos con ≥ 1 lote en bid y ask. Muestra prima neta, rendimiento sobre el subyacente,
ganancia/pérdida máxima, breakevens, gráfico de payoff y la cadena de opciones del OPEX vigente (meses pares).

## Solapas

- **Estrategias armables**: las cuatro estrategias automáticas de arriba más la cadena de opciones.
- **Estrategia armada**: armador manual. Elegís vencimiento, CALL/PUT o acciones GGAL, base, compra/venta,
  cantidad y precio (precargado con bid/ask de mercado, editable) y se dibuja el payoff al instante.
  La estrategia en curso y las guardadas con nombre se persisten en el `localStorage` del navegador
  (quedan en ese dispositivo/navegador; no se sincronizan). `index.html#builder` abre directo esa solapa.
- **PUTs bajo la par**: compra GGAL (ask) + compra PUT (ask). Resultado asegurado = Base − costo de armar.
  Tabla en verde/rojo y gráfico de barras con el % de desarbitraje por base (línea de cero = breakeven), rendimiento y TNA.
- **CALLs bajo la par**: lanzamiento cubierto ITM, compra GGAL (ask) + venta CALL (bid), solo bases ≤ GGAL.
  Misma tabla y gráfico. `#puts` / `#calls` abren esas solapas.

## Uso local

Abrí `index.html` con doble clic. No requiere servidor ni build.

## Publicar en GitHub Pages

1. Creá un repo vacío en GitHub (por ejemplo `OptionDash`) **sin** README ni .gitignore.
2. En esta carpeta:

   ```powershell
   git remote add origin https://github.com/<tu-usuario>/OptionDash.git
   git push -u origin main
   ```

3. En GitHub: **Settings → Pages → Build and deployment → Source: "Deploy from a branch"**,
   Branch: `main`, carpeta `/ (root)` → **Save**.
4. En ~1 minuto queda en `https://<tu-usuario>.github.io/OptionDash/`.
   Cada `git push` a `main` vuelve a publicar.

Opcional: en la misma pantalla de Pages podés agregar un dominio propio (`Custom domain`) para una URL más corta.

## Archivos

| Archivo       | Descripción                                   |
|---------------|-----------------------------------------------|
| `index.html`  | Página principal                              |
| `app.js`      | Lectura del Sheet, selección de bases, payoff |
| `styles.css`  | Estilos                                       |
| `logo.jpg`    | Avatar del header                             |
| `.nojekyll`   | Evita el procesamiento Jekyll en Pages        |
