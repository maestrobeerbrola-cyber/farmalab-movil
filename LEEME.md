# FARMA·LAB móvil v0.3.23 (prototipo)

App que se instala desde Chrome o Edge (Android y Windows) y funciona sin conexión. Los datos se guardan **en el propio dispositivo** y, si se configura, se sincronizan entre el móvil y el PC a través de Google Drive.

## Qué incluye
- **Almacén.** Materias primas con número de control interno, proveedor, lote, boletín de análisis y ficha de seguridad adjuntos, detección de excipientes de declaración obligatoria y cambio de estado (cuarentena, aceptado, rechazado, bloqueado). Material de acondicionamiento (envases) con su ficha y su stock.
- **Fórmulas.** Varios componentes, códigos nacionales por presentación o concentración, PNT vinculados y estados borrador, aprobada y obsoleta.
- **Elaborar.** Guía de elaboración (RD 175/2001): pesadas con lote, envases usados, utillaje, control de calidad y decisión del farmacéutico. Estados en proceso, elaborada y dispensada. Lote `[Año]-J-[Mes]-FM-[Número]` consecutivo, que nunca se reinicia. Número de libro recetario al dispensar.
- **Registros del RD 175/2001 en PDF A4**, listos para imprimir y firmar: registro y especificaciones de materias primas (anexos II y III del PN/L/PG/005/00 del Formulario Nacional), registro de material de acondicionamiento (anexo II del PN/L/PG/006/00) y ficha 2 (registro de formulación magistral), todos con el diseño de los registros del Formulario Nacional.
- **Etiquetas en PDF** en folio A4 (8 o 2 por folio). Paciente, prescriptor y nº de colegiado se escriben solo al imprimir y no se guardan.
- **Avisos en la app**: stock bajo, envases por reponer, caducidades, cuarentena, elaboraciones paradas más de 2 días y datos que faltan.
- **Calculadora**: cantidad a pesar (% m/m, m/v, v/v, mg/g, mg/ml, ppm, 1:X, mg por unidad) con riqueza, factor sal/base y densidad; conversión de unidades y diluciones.
- **Precio de las fórmulas financiadas** (Comunidad de Madrid), ver abajo.
- **Temperaturas** (PN/L/PG/009/00): lectura diaria del local y la nevera, incidencias y registro mensual en PDF.
- **Documentos**: PNT y bibliografía con su PDF, Word o foto, que se consultan dentro de la app, también sin conexión.
- Registro de actividad, bloqueo con PIN, exportar e importar copias.

## Novedades de la v0.3.23
- **El archivo también para el material de acondicionamiento** (Almacén → Acondicionamiento → «Terminados, caducados y rechazados»): «Marcar como terminado», paso automático al archivo al caducar, con registro de la eliminación de las unidades que queden, y «Devolver a la lista» si hay un error. Los envases archivados ya no se proponen en la guía de elaboración ni en las etiquetas de estado.
- **Los lotes rechazados pasan al archivo al registrar su destino** (devolución al proveedor o eliminación), tanto de materias primas como de acondicionamiento. Mientras no se registre, siguen en la lista con su formulario de destino. Desde la ficha archivada se puede anular el registro del destino.

## Novedades de la v0.3.22
- **Archivo de materias primas terminadas y caducadas** (Almacén → Materias primas → «Terminadas y caducadas»). Un lote aceptado se marca como terminado desde su ficha («Marcar como terminada»): sale de la lista, su stock pasa a 0 y queda en el archivo con la fecha y tu nombre. Si caduca, pasa solo al archivo; si aún tiene existencias, se pide retirarlo y registrar su devolución al proveedor o su eliminación (aviso rojo hasta que se registre). Los lotes archivados conservan su ficha, sus documentos y las elaboraciones en que se usaron, siguen en el registro en PDF (con la terminación o la eliminación en «Observaciones») y ya no se proponen en las elaboraciones ni en las etiquetas de estado. Un lote terminado por error se devuelve a la lista desde su ficha.
- Los lotes sin existencias se señalan en la lista y, al marcar una elaboración como elaborada, la app avisa de los lotes que se han quedado a 0.

## Novedades de la v0.3.21
- **Especificaciones (anexo III) propuestas desde el Formulario Nacional.** Al escribir el nombre de una materia prima nueva, o con el botón «Proponer desde el Formulario Nacional», se rellenan las casillas vacías: «Cumple RFE», nº y título de la monografía y, si el FN los da, las características y la conservación. Incluye las 39 materias primas con monografía en el FN y unas 70 más que aparecen en sus tablas de materias primas (excipientes, fórmulas tipificadas y preparados oficinales). Reconoce nombres en otro orden o sinónimos (lidocaína clorhidrato = hidrocloruro de lidocaína, bicarbonato sódico…). Las precauciones y la toxicidad se completan con la ficha de seguridad.
- **Etiquetas de estado para los envases**: «En cuarentena», «Aceptado» con el nº de registro interno y la caducidad, «Rechazado» y «Bloqueado», de materias primas y acondicionamiento. Desde la ficha de cada lote o varias a la vez (Almacén → Etiquetas de estado), en hojas A4 de 8 (105 × 74 mm) o 24 etiquetas (70 × 37 mm), empezando en la etiqueta que se quiera para aprovechar hojas usadas.
- **Diseño para el PC**: en pantallas anchas el menú pasa a la izquierda, el Inicio se ordena en dos columnas y los formularios largos y las fichas del almacén se reparten en dos columnas.
- **Comprobar la sincronización** (Ajustes → Sincronización): revisa paso a paso la configuración, la dirección de la app, la conexión, la sesión de Google, Google Drive y el último envío (desde qué equipo y con qué versión), hace una sincronización de prueba y explica cómo arreglar cada error (por ejemplo, «Error 403: access_denied»: añadir la cuenta como usuario de prueba).

## Novedades de la v0.3.20
- **La ficha 2 (registro de formulación magistral) tiene el mismo diseño que los registros de materias primas y acondicionamiento**: cabecera azul con el título («Guía de elaboración, control y registro de fórmula magistral» o «de preparado oficinal»), el código y la página, y los PNT de la fórmula como procedimientos relacionados; «FICHA 2» en rojo; celdas azules con la etiqueta y blancas con el dato; un apartado por cada punto del RD 175/2001 (composición, modus operandi, materias primas, acondicionamiento, personal y utillaje, control de calidad, dispensación), «Observaciones» y la decisión con fecha y firma del farmacéutico responsable. Las tablas largas siguen en la página siguiente con su cabecera.
- El código de la cabecera (por defecto, RD 175/2001) se puede cambiar en Ajustes.

## Novedades de la v0.3.19
- **Temperatura tiene su propia pestaña** en el menú de abajo, entre Elaborar y Documentos. Lleva un punto ámbar si falta la lectura de hoy y rojo si hay una temperatura fuera de rango o una incidencia abierta.

## Novedades de la v0.3.18
- **Control y registro de temperaturas según el PN/L/PG/009/00 del Formulario Nacional** (pestaña Temperatura).
  - Lectura diaria de la temperatura actual, la máxima y la mínima del local (20–30 ºC) y de la nevera (2–8 ºC), con fecha, hora y firma. Se pueden añadir más neveras o zonas y cambiar los rangos (Ajustes → Temperaturas).
  - Si una lectura se sale del rango, la app avisa de que no se dispensen los productos afectados y abre el registro de incidencia (anexo IV): temperatura alcanzada, horas de exposición desde la lectura anterior, productos afectados (propone las materias primas y fórmulas que se conservan en ese punto), análisis de causas, evaluación, tratamiento (se acepta o se rechaza), medida correctora, fecha y firma. Numeración correlativa por año (1/2026, 2/2026…).
  - En Inicio, «Temperaturas de hoy» y avisos: lectura pendiente, lectura fuera de rango sin incidencia e incidencia abierta.
  - Registro mensual en PDF con el diseño del Formulario Nacional: anexo II a) (gráfico del local), anexo II b) (tabla de actual, máxima y mínima), anexo III (nevera) y anexo IV (incidencias). Sin lecturas sale la hoja en blanco para rellenar a mano.
  - Las lecturas y las incidencias van en las copias de seguridad y en la sincronización. **Actualiza la app en el móvil y en el PC**: un equipo sin actualizar deja de sincronizar hasta que se actualiza.

## Novedades de la v0.3.17
- **Casilla propia para la fecha de caducidad** en el registro de materias primas (anexo II), junto al control de calidad. Si el lote no tiene caducidad, aparece la fecha del próximo control analítico. El registro de acondicionamiento y la ficha 2 ya la tenían.
- **Casillas necesarias en rojo.** En el alta y edición de materias primas, envases y fórmulas, en el control de conformidad y en la guía de elaboración, lo que hace falta para generar el registro en PDF lleva un asterisco rojo y, mientras está vacío, un recuadro rojo. Arriba del formulario se indica cuántas casillas faltan; cuando están todas, el aviso pasa a verde. Lo que depende de otra respuesta se pide solo cuando toca (por ejemplo, el nº de monografía al elegir «Cumple RFE» o el lote solo en el acondicionamiento primario).

## Novedades de la v0.3.16
- **Material de acondicionamiento según el PN/L/PG/006/00 del Formulario Nacional** («Recepción y almacenamiento del material de acondicionamiento»).
  - El PDF reproduce el anexo II «Registro de material de acondicionamiento»: cabecera azul con título, código y página; ficha con nº de registro interno, identificación del producto, proveedor, lote, fecha de recepción, cantidad, nº de envases, caducidad, condiciones de conservación, decisión final, fecha y firma; y «Observaciones» debajo (inspección, devolución, eliminaciones, revisión y fórmulas donde se ha usado).
  - Al dar de alta un envase se le asigna el nº de registro interno siguiente (AC-0001, AC-0002…) si no se escribe otro.
  - Revisión anual del estado (4.3), con aviso en Inicio cuando pasa un año, igual que las materias primas.
  - Eliminación del material caducado, obsoleto o deteriorado: se registra y se descuenta del stock.
  - Un envase rechazado pide registrar su destino (devolución o eliminación).
  - Registro de todos los envases de un año en PDF (Almacén → Envases). El código del PNT se cambia en Ajustes.

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
