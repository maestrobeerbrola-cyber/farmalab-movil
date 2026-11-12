# FARMA·LAB móvil v0.3 (prototipo)

App para Android que se instala desde Chrome y funciona sin conexión. Todos los datos se guardan **en el propio teléfono**.

## Qué incluye
- **Almacén.** Materias primas con número de control interno, proveedor, lote, boletín de análisis y ficha de seguridad adjuntos, detección de excipientes de declaración obligatoria y cambio de estado (cuarentena, aceptado, rechazado, bloqueado). Material de acondicionamiento (envases) con su ficha y su stock.
- **Fórmulas.** Varios componentes, códigos nacionales por presentación o concentración, PNT vinculados y estados borrador, aprobada y obsoleta.
- **Elaborar.** Guía de elaboración (RD 175/2001): pesadas con lote, envases usados, utillaje, control de calidad y decisión del farmacéutico. Estados en proceso, elaborada y dispensada. Lote `[Año]-J-[Mes]-FM-[Número]` consecutivo, que nunca se reinicia. Número de libro recetario al dispensar.
- **Etiquetas en PDF** en folio A4 (8 o 2 por folio). Paciente, prescriptor y nº de colegiado se escriben solo al imprimir y no se guardan.
- **Avisos en la app**: stock bajo, envases por reponer, caducidades, cuarentena, elaboraciones paradas más de 2 días y datos que faltan.
- **Calculadora**: cantidad a pesar (% m/m, m/v, v/v, mg/g, mg/ml, ppm, 1:X, mg por unidad) con riqueza, factor sal/base y densidad; conversión de unidades y diluciones.
- **Precio de las fórmulas financiadas** (Comunidad de Madrid), ver abajo.
- **Documentos**: PNT y bibliografía con su PDF o Word, que se consultan dentro de la app, también sin conexión.
- Registro de actividad, bloqueo con PIN, exportar e importar copias.

## Novedades de la v0.3
- Almacén con materias primas y acondicionamiento, alertas de stock y caducidad, y enlaces de búsqueda en la AEMPS.
- Fórmulas con códigos nacionales y PNT vinculados.
- Elaboración completa con lotes, dispensación y etiquetas en PDF.
- Calculadora y bibliografía.
- **Valoración de fórmulas** (icono de la calculadora → pestañas *Valoración* y *Precio tasado*):
  - **Precio tasado**: las 187 fórmulas con código nacional propio y PVP fijo (listado de enero de 2026), con buscador por nombre o CN. También los preparados oficinales con precio fijo (alcohol boricado y sulfato de cobre).
  - **Valoración** según el Anexo 3 del Convenio 2023-2027: principios activos (Tabla I, 428 en €/g), excipiente (Tabla II, por 100 ml/g o fracción o por unidad), honorarios (Tabla III, con el factor P) y envase (Tabla IV), más IVA. Da el desglose «a, b, c, d, Subtotal X, IVA e, Total Y» para la receta en papel y se puede copiar.
  - Avisa si un principio activo no está en la Tabla I, si se pasa del máximo dispensable o si la Tabla I lo admite solo como monofármaco.
  - Desde una elaboración, «Calcular el precio de valoración» rellena la forma, la cantidad y los principios activos, y el resultado se guarda en la elaboración. Si su CN tiene precio tasado, la ficha muestra el PVP y no pide valorarla.
  - El factor P (3,65 € en 2026) y el IVA (4 %) se cambian en Ajustes. Cada concepto se redondea a céntimos. Es una valoración orientativa: compruébala antes de facturar.

## 1. Publicarla en GitHub Pages
La app está en el repositorio `farmalab-movil` y se publica sola en `https://TU-USUARIO.github.io/farmalab-movil/` cada vez que cambian sus archivos.

Si la subes a mano: **Add file → Upload files** y arrastra todo el contenido de esta carpeta, es decir, los archivos (`index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest`, `LEEME.md`) **y las carpetas `icons`, `modulos`, `datos` y `vendor`**. Las carpetas solo se suben arrastrándolas. En **Settings → Pages**, *Deploy from a branch*, rama `main`, carpeta `/ (root)`.

En GitHub solo está el programa y las tablas públicas de precios. **Tus datos nunca se suben**: se quedan en el teléfono.

## 2. Instalarla en Android
1. Abre la dirección en **Chrome** en el teléfono.
2. Escribe tu nombre y elige un PIN de 4 a 8 cifras.
3. Menú de Chrome (⋮) → **Instalar aplicación**.
4. Ábrela desde su icono y ve a **Ajustes → Proteger datos**, para que Android no la borre si se queda sin espacio.

## 3. Copias de seguridad (importante)
Los datos solo están en ese teléfono. Se pierden si el teléfono se pierde o se rompe, si desinstalas la app o si borras los datos de Chrome.
- **Ajustes → Exportar copia** guarda un archivo `.json` en Descargas, con los documentos adjuntos y los ajustes. Guárdalo también fuera del teléfono.
- La pantalla de inicio avisa cuando hay cambios sin copiar desde hace más de 7 días.
- **Importar copia** añade lo que no tengas y actualiza lo más reciente. No borra nada. La numeración de lotes nunca retrocede.

## 4. PIN
- La app se bloquea tras 5 minutos en segundo plano o 15 sin usarla.
- El PIN no se puede recuperar. Si lo olvidas, la única salida es borrar los datos e importar una copia.
- Los datos del teléfono no están cifrados. Mantén activado el bloqueo del propio teléfono.

## 5. Actualizar a una versión nueva
1. Antes, exporta una copia desde la app (Ajustes → Exportar copia).
2. Abre la app con conexión. Cuando aparezca «Hay una versión nueva de FARMA·LAB», pulsa **Actualizar**. Si no aparece en unos minutos, ciérrala y ábrela otra vez. La versión instalada aparece en Ajustes → Acerca de. Tus datos se conservan y se adaptan solos al formato nuevo.

## 6. Compartir con la versión de PC (más adelante)
Cada registro lleva un identificador único, la fecha de su último cambio y el dispositivo donde se creó. El archivo de copia (`formato: farmalab-datos`, versión 3) está pensado para que la versión de PC pueda importarlo. La versión de PC aún no tiene almacén, valoración ni etiquetas; esa importación y la sincronización son los siguientes pasos.

## Fuentes de los datos de precios
- Anexo 3 del Convenio entre la Comunidad de Madrid y el Colegio Oficial de Farmacéuticos de Madrid (2023-2027): Tablas I a IV y preparados oficinales.
- Fórmulas magistrales con precio tasado, ordenadas alfabéticamente, enero de 2026.
- Honorarios para la valoración de fórmulas magistrales, enero de 2026 (factor P = 3,65 €).

Cuando se publiquen precios nuevos, hay que sustituir los archivos de la carpeta `datos` y, si cambia, el factor P en Ajustes.

## Librerías incluidas
Visor de PDF: pdf.js de Mozilla (Apache 2.0). Lector de Word: mammoth (BSD). Generador de etiquetas en PDF: pdf-lib (MIT). Están en la carpeta `vendor` con sus licencias y funcionan sin conexión.

## Límites importantes
- Es un prototipo técnico, no un sistema validado ni un libro oficial de registro.
- No guardes datos identificativos ni clínicos de pacientes en las fichas. En la etiqueta se escriben al imprimir y no se guardan.
- La calculadora y la valoración son ayudas: el farmacéutico responsable debe revisar cantidades y precios.
- Según la AEMPS, su web corporativa no se actualiza desde el 9 de junio de 2026. Los enlaces de alertas abren su buscador; las alertas nuevas hay que consultarlas por los canales que indique la AEMPS.
- Antes de usarla de verdad hace falta una revisión técnica, pruebas, copias restaurables, validación y una evaluación de protección de datos.
