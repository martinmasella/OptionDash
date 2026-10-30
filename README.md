# OptionDash by Tinchex Capital

Dashboard estático de estrategias de volatilidad sobre opciones de **GGAL (BYMA)**.
Lee en tiempo real la hoja «Sabro» de un Google Sheet público y arma automáticamente:

1. Straddle vendido (bases ATM)
2. Strangle vendido (≈ ±10 %)
3. Butterfly comprado (cuerpo ATM)
4. Iron Condor vendido (cortos ≈ ±10 %, alas en la siguiente base líquida)

Solo usa contratos con ≥ 1 lote en bid y ask. Muestra prima neta, rendimiento sobre el subyacente,
ganancia/pérdida máxima, breakevens, gráfico de payoff y la cadena de opciones del OPEX vigente (meses pares).

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
