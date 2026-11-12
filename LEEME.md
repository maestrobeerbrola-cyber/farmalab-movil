# FARMA·LAB móvil v0.1 (prototipo)

App para Android que se instala desde Chrome y funciona sin conexión. Todos los datos se guardan **en el propio teléfono**.

Incluye lo mismo que la versión de PC y algunas mejoras:
- Materias primas: alta de lotes, búsqueda y cambio de estado (cuarentena, aceptado, bloqueado).
- Fórmulas con **varios componentes**, y estados borrador, aprobada y obsoleta.
- Elaboraciones a partir de fórmulas aprobadas, con escalado proporcional y vista previa de las cantidades.
- Hoja de pesadas: teórico y real, diferencia, lote con sugerencias y avisos si el lote está en cuarentena, bloqueado, caducado o no registrado. Envío a revisión.
- PNT con aviso de revisión vencida.
- Inicio: elaboraciones abiertas, caducidades próximas y aviso de copia de seguridad pendiente.
- Registro de actividad, bloqueo con PIN, exportar e importar copias.

## 1. Publicarla en GitHub Pages (una sola vez, desde el ordenador)
1. Crea una cuenta gratuita en https://github.com si no la tienes.
2. Arriba a la derecha, **+ → New repository**. Nombre: `farmalab-movil`. Marca **Public**. Pulsa **Create repository**.
3. En el repositorio vacío, pulsa **uploading an existing file**. Arrastra **el contenido** de esta carpeta (`index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest` y la carpeta `icons`), no la carpeta entera. Pulsa **Commit changes**.
4. Ve a **Settings → Pages**. En *Build and deployment*, elige *Source: Deploy from a branch*, rama `main` y carpeta `/ (root)`. Pulsa **Save**.
5. En uno o dos minutos la app estará en: `https://TU-USUARIO.github.io/farmalab-movil/`

En GitHub solo está el programa. **Tus datos nunca se suben**: se quedan en el teléfono.

## 2. Instalarla en Android
1. Abre esa dirección en **Chrome** en el teléfono.
2. Escribe tu nombre y elige un PIN de 4 a 8 cifras.
3. Menú de Chrome (⋮) → **Instalar aplicación** (o **Añadir a pantalla de inicio → Instalar**).
4. Ábrela desde su icono y ve a **Ajustes → Proteger datos**, para que Android no la borre si se queda sin espacio.

## 3. Copias de seguridad (importante)
Los datos solo están en ese teléfono. Se pierden si el teléfono se pierde o se rompe, si desinstalas la app o si borras los datos de Chrome.
- **Ajustes → Exportar copia** guarda un archivo `.json` en Descargas. Guárdalo también fuera del teléfono: correo, Drive o el PC.
- La pantalla de inicio avisa cuando hay cambios sin copiar desde hace más de 7 días.
- **Importar copia** (en un teléfono nuevo o tras borrar los datos) añade lo que no tengas y actualiza lo más reciente. No borra nada.

## 4. PIN
- La app se bloquea tras 5 minutos en segundo plano o 15 sin usarla. Al desbloquear, sigues donde estabas, sin perder lo que hubieras escrito.
- El PIN no se puede recuperar. Si lo olvidas, la única salida es borrar los datos e importar una copia.
- El PIN protege la entrada a la app, pero los datos del teléfono no están cifrados. Mantén activado el bloqueo del propio teléfono.

## 5. Actualizar a una versión nueva
Sube los archivos nuevos al mismo repositorio, sustituyendo los anteriores. La app mostrará «Hay una versión nueva de FARMA·LAB» con el botón **Actualizar**. Tus datos se conservan.

## 6. Compartir con la versión de PC (más adelante)
Cada registro lleva un identificador único, la fecha de su último cambio y el dispositivo donde se creó. El archivo de copia (`formato: farmalab-datos`, versión 1) está pensado para que la versión de PC pueda importarlo. Esa importación y la sincronización automática con un servidor son los siguientes pasos; todavía no están hechas.

## Límites importantes
- Es un prototipo técnico, no un sistema validado ni un libro oficial de registro.
- No introduzcas datos personales identificativos ni datos clínicos reales. Para el paciente, usa un código interno.
- El escalado es solo proporcional. No calcula densidad, mermas, sobrellenado ni conversiones de unidades; debe revisarlo el farmacéutico responsable.
- Enviar a revisión no libera ni autoriza el preparado.
- Antes de usarla de verdad hace falta una revisión técnica, pruebas, copias restaurables, validación y una evaluación de protección de datos.
