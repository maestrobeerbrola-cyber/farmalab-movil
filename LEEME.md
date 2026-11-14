# FARMA·LAB móvil v0.3.15 (prototipo)

App que se instala desde Chrome o Edge (Android y Windows) y funciona sin conexión. Los datos se guardan **en el propio dispositivo** y, si se configura, se sincronizan entre el móvil y el PC a través de Google Drive.

## Qué incluye
- **Almacén.** Materias primas con número de control interno, proveedor, lote, boletín de análisis y ficha de seguridad adjuntos, detección de excipientes de declaración obligatoria y cambio de estado (cuarentena, aceptado, rechazado, bloqueado). Material de acondicionamiento (envases) con su ficha y su stock.
- **Fórmulas.** Varios componentes, códigos nacionales por presentación o concentración, PNT vinculados y estados borrador, aprobada y obsoleta.
- **Elaborar.** Guía de elaboración (RD 175/2001): pesadas con lote, envases usados, utillaje, control de calidad y decisión del farmacéutico. Estados en proceso, elaborada y dispensada. Lote `[Año]-J-[Mes]-FM-[Número]` consecutivo, que nunca se reinicia. Número de libro recetario al dispensar.
- **Registros del RD 175/2001 en PDF A4**, listos para imprimir y firmar: registro y especificaciones de materias primas (anexos II y III del PN/L/PG/005/00 del Formulario Nacional), registro de material de acondicionamiento (apartado 3.3) y ficha 2 (registro de formulación magistral).
- **Etiquetas en PDF** en folio A4 (8 o 2 por folio). Paciente, prescriptor y nº de colegiado se escriben solo al imprimir y no se guardan.
- **Avisos en la app**: stock bajo, envases por reponer, caducidades, cuarentena, elaboraciones paradas más de 2 días y datos que faltan.
- **Calculadora**: cantidad a pesar (% m/m, m/v, v/v, mg/g, mg/ml, ppm, 1:X, mg por unidad) con riqueza, factor sal/base y densidad; conversión de unidades y diluciones.
- **Precio de las fórmulas financiadas** (Comunidad de Madrid), ver abajo.
- **Documentos**: PNT y bibliografía con su PDF, Word o foto, que se consultan dentro de la app, también sin conexión.
- Registro de actividad, bloqueo con PIN, exportar e importar copias.

## Novedades de la v0.3.15
- El registro de materias primas (anexo II) y las especificaciones (anexo III) reproducen el diseño del PN/L/PG/005/00 de la 3.ª edición del Formulario Nacional: cabecera azul con el título, el código y la página; «ANEXO» en rojo; ficha de registro por lote con las celdas del modelo (registro interno, nombre del producto, proveedor, lote, control de calidad, fecha de recepción, cantidad, número de envases, decisión final, fecha y firma) y «Observaciones» debajo; y la rejilla de especificaciones del anexo III. El registro anual pone una ficha por lote.

## Novedades de la v0.3.14
- **Materias primas según el PN/L/PG/005/00 del Formulario Nacional** («Recepción, control de conformidad y almacenamiento de materias primas»).
  - Recepción (4.1): al dar de alta un lote hay que marcar la inspección (albarán = pedido, material = albarán, envases, embalajes y etiquetas en buen estado). El lote queda siempre en cuarentena.
  - Especificaciones (anexo III): origen (Cumple RFE con nº de monografía, otra farmacopea o fabricante/proveedor), monografía, identificación, impurezas, procedimientos analíticos, conservación, precauciones y toxicidad. En un lote nuevo de un producto ya registrado se copian del lote anterior.
  - Control de conformidad (4.2) y aceptación: al aceptar se asigna el nº de registro interno siguiente (MP-0001, MP-0002…). Un lote rechazado pide registrar su destino (devolución o eliminación).
  - Revisión anual (4.3): botón en el lote aceptado y aviso en Inicio cuando pasa un año sin revisar.
  - PDF con el formato del Formulario Nacional (cabecera con título, código, página y procedimientos relacionados): anexo II «Registro de materias primas» y anexo III «Especificaciones» de cada lote, y el registro de todos los lotes de un año (Almacén → Materias primas). El código del PNT se cambia en Ajustes.
- Los PDF escriben ≤, ≥ y ≈ como <=, >= y ~ (la fuente no tiene esos signos).

## Novedades de la v0.3.13
- **Fotos en todos los adjuntos.** Boletines de análisis, fichas de seguridad, especificaciones, documentos de envases, PNT, bibliografía y recetas admiten PDF, Word o foto. En el móvil hay un botón «Hacer foto» que abre la cámara; también se puede elegir una imagen JPG, PNG o WebP guardada. En el PC se elige el archivo.
- Las fotos se guardan como JPG de hasta 2400 px por el lado largo (un folio se sigue leyendo bien): ocupan mucho menos, se ven derechas y se les quita la ubicación GPS y el resto de metadatos. Salvo las recetas, entran en las copias y en la sincronización como cualquier documento.

## Novedades de la v0.3.12
- **Envase incluido con la materia prima.** Para vehículos que se elaboran en su propio frasco (por ejemplo, Finastopic), la ficha del lote tiene la casilla «Se elabora en su propio envase» y la descripción del envase. En la guía de elaboración aparece ya propuesto como material de acondicionamiento, con el lote del vehículo usado; no se descuenta aparte del stock de envases y figura en la ficha 2.
- **Materias primas que pueden ser activo o excipiente** (por ejemplo, el bicarbonato sódico): nuevo tipo «Activo o excipiente». Lo que cuenta en etiquetas, fichas y valoración es la función que se marca en cada fórmula.

## Novedades de la v0.3.11
- **Sincronización del móvil y el PC con Google Drive** (Ajustes → Sincronización móvil y PC). Los datos van a la carpeta oculta de la app en el Drive de la cuenta configurada (permiso `drive.appdata`: la app no ve ni toca ningún otro archivo). Se juntan los cambios de los dos equipos: gana la versión más reciente de cada registro y no se borra nada, salvo lo borrado por fin del plazo de conservación. Las recetas y el PIN no se sincronizan.
- Botón de la nube en la barra superior: sincroniza al momento y su punto indica el estado (verde, al día; ámbar, pendiente; rojo, error). Con la sesión de Google abierta (dura alrededor de una hora), los cambios se envían solos a los pocos segundos y los del otro equipo llegan cada 5 minutos.
- Antes de asignar un número de lote se sincroniza, para no repetirlo. Si aun así se repite (por ejemplo, sin conexión), aparece un aviso y se puede dar un lote nuevo a una de las elaboraciones.
- Los borrados por fin del plazo de conservación se recuerdan y viajan también en las copias de seguridad, para que el registro no vuelva desde el otro equipo.

## Novedades de la v0.3.10
- Arreglo: en una elaboración ya elaborada o dispensada se puede completar o corregir el **material de acondicionamiento**. Al guardar la guía, se descuenta del stock lo que se añade y se repone lo que se quita (con confirmación y anotación en la actividad).
- Arreglo: al vaciar la última fila de una lista (envases, componentes, ensayos...), también se vacían sus desplegables.

## Novedades de la v0.3.9
- **Conservación de registros con borrado automático.** Plazos desde la caducidad: elaboraciones 1 año (2 si contienen psicótropos; 5 si contienen estupefacientes o son de uso veterinario); materias primas y material de acondicionamiento, 1 año. Se cambian en Ajustes.
- La clase de cada fórmula (general, psicótropos, estupefacientes, uso veterinario) se elige en la fórmula y la heredan sus elaboraciones.
- **Aviso 30 días antes** en Inicio y en Ajustes → Conservación. Un registro nunca se borra sin haber estado avisado al menos 30 días, aunque su plazo ya hubiera pasado.
- El borrado se hace al abrir la app (una vez al día) e incluye sus documentos (recetas, boletines...). Queda anotado en el registro de actividad.
- Un lote de materia prima o de envase se conserva mientras se conserve alguna elaboración que lo usó. Sin fecha de caducidad no se borra.
- «No borrar» en la ficha o en Conservación excluye un registro del borrado. En Ajustes se puede desactivar el borrado y dejar solo los avisos.

## Novedades de la v0.3.8
- **Código nacional en la etiqueta**, debajo del nombre de la fórmula («C.N. 500017»). Al generar la etiqueta se elige entre los códigos de la fórmula; por defecto, el de la elaboración o el de la presentación con la misma cantidad. Si la elaboración no tenía código, el elegido se guarda también en ella. Si la fórmula no tiene códigos, se puede escribir a mano.
- La ficha de registro también muestra el código nacional.

## Novedades de la v0.3.7
- **Receta en cada elaboración**: apartado «Receta» para adjuntar la receta en PDF, Word o foto (botón «Hacer foto» con la cámara, o «Elegir archivo»). Se ve dentro de la app y se puede eliminar.
- Las recetas **solo se guardan en este dispositivo**: no van en las copias de seguridad ni en la sincronización, porque contienen datos del paciente. En el registro de actividad no se anota el nombre del archivo.

## Novedades de la v0.3.6
- Arreglo: en las listas con buscador (fórmulas, almacén, PNT, precio tasado...), la barra de búsqueda tapaba el primer elemento. Ahora queda fija bajo la cabecera y la lista empieza debajo.

## Novedades de la v0.3.5
- **Editar PNT**: código, título, versión, categoría, fechas y ubicación del original («Editar PNT» en su ficha). El documento y el estado se siguen cambiando desde la ficha.
- **Eliminar fórmulas y PNT**: botón «Eliminar» al final de su ficha. Pasan a la **papelera** (Ajustes → Papelera, o «Eliminadas» al final de cada lista), desde donde se pueden restaurar con sus documentos y vínculos.
  - Una fórmula con una elaboración en proceso no se puede eliminar hasta terminarla o rechazarla. Las elaboraciones ya hechas conservan todos sus datos.
  - Un PNT eliminado deja de aparecer en las fórmulas que lo usan; si se restaura, vuelve.
  - La eliminación viaja en las copias: al importar la copia en otro equipo, también se elimina allí.

## Novedades de la v0.3.4
- **Registro de material de acondicionamiento en PDF** (RD 175/2001, apartado 3.3, y anexo II del PN/L/PG/006). Desde la ficha del envase, «Registro de acondicionamiento en PDF»: nº de registro interno, identificación, proveedor, lote, fecha de recepción, cantidad y nº de envases, caducidad y conservación (o «No procede»), inspección en la recepción, fórmulas en las que se ha usado, observaciones, decisión final y firma.
- **Inspección en la recepción** (PN/L/PG/006, apartado 4.1) en la ficha de cada envase: albarán, correspondencia del material y estado de envases, embalajes y etiquetado, con quién la hizo y la fecha. Para registrar un envase como aceptado hay que marcar las tres comprobaciones.

## Novedades de la v0.3.3
- **Control de calidad de materias primas.** Cada lote tiene un apartado de control de calidad: ensayos con su técnica o método, resultado y conformidad, quién lo hizo, fecha, descripción de los métodos analíticos y fecha de repetición del control, si procede. Los ensayos por defecto se cambian en Ajustes.
- **Ficha 1 en PDF** (sustituida en la v0.3.14 por el registro y las especificaciones del PN/L/PG/005/00).
- Al aceptar un lote, la app avisa si no hay resultados del control de calidad o si algún ensayo no es conforme.
- En las fichas solo aparecen las pruebas realizadas (con resultado).

## Novedades de la v0.3.2
- **Ficha de registro en PDF.** En una elaboración elaborada, dispensada o rechazada, «Ficha de registro en PDF» genera la ficha 2 del RD 175/2001 en A4, con diseño actualizado: identificación y lote, composición, modus operandi (PNT), utillaje, materias primas con nº de control, lote, proveedor y cantidades teórica y pesada, acondicionamiento, personal elaborador, control de calidad, dispensación, observaciones, conformidad y recuadro de firma.
- Si a la guía le faltan datos, se genera como **borrador** y se indica qué falta. Si aún no está dispensada, los datos de dispensación salen en blanco para escribirlos a mano.
- El prescriptor y el paciente se pueden escribir al generarla, pero no se guardan.
- La guía de elaboración tiene un apartado nuevo, **Personal elaborador** (farmacéutico/s y auxiliares).

## Novedades de la v0.3
- Almacén con materias primas y acondicionamiento, alertas de stock y caducidad, y enlaces de búsqueda en la AEMPS.
- Fórmulas con códigos nacionales y PNT vinculados.
- Elaboración completa con lotes, dispensación y etiquetas en PDF.
- Calculadora y bibliografía.
- **Valoración de fórmulas** (icono de la calculadora → pestañas *Valoración* y *Precio tasado*):
  - **Precio tasado**: las 187 fórmulas con código nacional propio y PVP fijo (listado de enero de 2026), con buscador por nombre o CN. También los preparados oficinales con precio fijo (alcohol boricado y sulfato de cobre).
  - **Valoración** según el Anexo 3 del Convenio 2023-2027: principios activos (Tabla I, 428 en €/g), excipiente (Tabla II, por 100 ml/g o fracción o por unidad), honorarios (Tabla III, con el factor P) y envase (Tabla IV), más IVA. Da el desglose «a, b, c, d, Subtotal X, IVA e, Total Y» para la receta en papel y se puede copiar.
  - Cada principio activo tiene su precio en €/g: si se deja vacío se usa el de la Tabla I; si no está en ella, se escribe su precio de coste (v0.3.1). Si cambias el de la Tabla I, avisa de que en las recetas financiadas se aplica el de la tabla.
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

## 6. Usarla en el PC y sincronizar con el móvil
En el PC se instala la misma app: abre la dirección de GitHub Pages con Chrome o Edge y usa «Instalar aplicación» en el menú (⋮ o …). Para que el móvil y el PC compartan los datos:

1. **Una sola vez, en Google Cloud** (con la cuenta de Google de la sincronización): crea un proyecto en console.cloud.google.com; en «APIs y servicios» → «Biblioteca», habilita **Google Drive API**; en «Google Auth Platform», configura la pantalla de consentimiento como **Externo** y añade la cuenta como **usuario de prueba**; en «Clientes», crea un cliente **Aplicación web** con el origen de JavaScript `https://maestrobeerbrola-cyber.github.io` y el URI de redirección `https://maestrobeerbrola-cyber.github.io/farmalab-movil/`. Copia el **ID de cliente**.
2. **En cada equipo**: Ajustes → Sincronización móvil y PC → escribe la cuenta de Google y el ID de cliente → «Guardar y conectar». Se abre la ventana de Google para confirmar la cuenta.
3. Si la ventana de Google no vuelve sola a la app (pasa en algunos móviles), usa «Conectar en esta ventana».

La cuenta y el ID de cliente se escriben en la app de cada equipo; no están en el código publicado. Solo se sincroniza si se entra con la cuenta configurada. Los datos de Drive se pueden borrar desde Google Drive → Configuración → Administrar aplicaciones.

## Fuentes de los datos de precios
- Anexo 3 del Convenio entre la Comunidad de Madrid y el Colegio Oficial de Farmacéuticos de Madrid (2023-2027): Tablas I a IV y preparados oficinales.
- Fórmulas magistrales con precio tasado, ordenadas alfabéticamente, enero de 2026.
- Honorarios para la valoración de fórmulas magistrales, enero de 2026 (factor P = 3,65 €).

Cuando se publiquen precios nuevos, hay que sustituir los archivos de la carpeta `datos` y, si cambia, el factor P en Ajustes.

## Librerías incluidas
Visor de PDF: pdf.js de Mozilla (Apache 2.0). Lector de Word: mammoth (BSD). Generador de etiquetas en PDF: pdf-lib (MIT). Están en la carpeta `vendor` con sus licencias y funcionan sin conexión.

## Límites importantes
- Es un prototipo técnico, no un sistema validado ni un libro oficial de registro.
- No guardes datos identificativos ni clínicos de pacientes en las fichas. En la etiqueta y la ficha de registro se escriben al imprimir y no se guardan. Las recetas adjuntas sí contienen esos datos: se quedan solo en el dispositivo, protegidas por el PIN, pero sin cifrar; mantén activado el bloqueo del teléfono y del PC.
- La calculadora y la valoración son ayudas: el farmacéutico responsable debe revisar cantidades y precios.
- Según la AEMPS, su web corporativa no se actualiza desde el 9 de junio de 2026. Los enlaces de alertas abren su buscador; las alertas nuevas hay que consultarlas por los canales que indique la AEMPS.
- Antes de usarla de verdad hace falta una revisión técnica, pruebas, copias restaurables, validación y una evaluación de protección de datos.
