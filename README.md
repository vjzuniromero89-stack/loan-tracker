# Control de Préstamos

Aplicación web para llevar el registro de préstamos a clientes: alta de clientes, cálculo automático de intereses y cuotas, historial de pagos, saldo pendiente, estado de cada préstamo (activo / pagado / atrasado) y un panel con el capital prestado, lo cobrado y la ganancia proyectada.

Corre sobre **Cloudflare Workers** (el servidor) con base de datos **Supabase** (Postgres administrado), así que los registros quedan guardados de forma permanente y la página es completamente dinámica (no es una página estática con datos de mentira). Funciona bien tanto en celular como en computadora.

## Cómo funciona el cálculo de intereses

Se usa **interés fijo** sobre el monto total prestado (no se multiplica por los meses de plazo):

```
interés total = monto prestado × (interés % / 100)
total a pagar = monto prestado + interés total
cuota mensual = total a pagar / meses de plazo
```

Ejemplo: prestas $5,000 al 40% a 5 meses → interés total $2,000, total a pagar $7,000, cuota mensual $1,400.

El estado de cada préstamo se calcula solo, comparando lo que el cliente debería llevar pagado a la fecha (según la cuota y los meses transcurridos desde el inicio) contra lo que realmente ha pagado:

- **Pagado**: ya cubrió el total a pagar.
- **Atrasado**: lleva pagado menos de lo esperado a la fecha.
- **Activo**: va al corriente.

## Requisitos antes de empezar

- Una cuenta gratuita de Cloudflare (https://dash.cloudflare.com/sign-up).
- Un proyecto de Supabase (https://supabase.com) con la URL y la `service_role` key a mano.
- Tener [Node.js](https://nodejs.org) instalado (18 o superior) en tu computadora.

## Pasos para desplegarla

Abre una terminal dentro de esta carpeta y sigue estos pasos, uno por uno.

### 1. Instalar las dependencias

```bash
npm install
```

### 2. Iniciar sesión en Cloudflare

```bash
npx wrangler login
```

Se abrirá el navegador para que autorices el acceso a tu cuenta.

### 3. Configurar los secretos

La aplicación necesita 4 valores secretos: la contraseña de acceso, la llave de sesión, y los datos de conexión a Supabase.

```bash
npx wrangler secret put APP_PASSWORD
npx wrangler secret put AUTH_SECRET
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
```

Cada uno te va a pedir que escribas el valor:

- `APP_PASSWORD`: la contraseña que quieras usar para entrar a la app.
- `AUTH_SECRET`: cualquier texto largo al azar (por ejemplo, 40 letras y números que te inventes). Sirve solo para que el servidor firme la sesión de forma segura.
- `SUPABASE_URL`: la URL de tu proyecto de Supabase, algo como `https://xxxxxxxx.supabase.co` (Project Settings → API).
- `SUPABASE_SERVICE_ROLE_KEY`: la llave `service_role` de ese mismo proyecto (Project Settings → API → Project API keys). Esta llave es secreta — nunca la pongas en el código ni la compartas.

### 4. Publicar la aplicación

```bash
npm run deploy
```

Al terminar, la terminal te muestra la URL pública, algo como `https://loan-tracker.tu-usuario.workers.dev`. Esa es la dirección donde vas a entrar desde tu celular o computadora.

## Uso diario

- Entra con la contraseña que configuraste.
- Ve a **Clientes** para registrar a tus clientes.
- Dentro de cada cliente, agrega sus **préstamos** (monto, interés y plazo en meses).
- Cuando un cliente te pague, entra al préstamo y usa **Registrar pago**.
- El **Panel** siempre te muestra el capital prestado, lo que has cobrado, la ganancia proyectada y los préstamos atrasados.

## Link para tus clientes (solo lectura)

Cada cliente tiene su propio link para ver el estado de su préstamo, sin necesidad de la contraseña de la app. Lo encuentras dentro de la ficha del cliente, en la sección **"Link para [nombre]"** — hay un botón para copiarlo.

Ese link es privado y único para ese cliente (lleva un código secreto larguísimo). Compártelo tú mismo por WhatsApp, correo, etc. Quien lo abra:

- Puede ver: sus préstamos, cuotas, pagos, saldo pendiente y si está al día o atrasado.
- No puede editar ni borrar nada, ni ver a otros clientes — solo lectura de su propia información.

## Actualizar la app en el futuro

Si más adelante quieres cambiarle algo (colores, textos, agregar algo), edita los archivos y vuelve a correr:

```bash
npm run deploy
```

O, más fácil, haz doble clic en `PUBLICAR_CAMBIOS.cmd`.

Tus datos (clientes, préstamos y pagos) viven en Supabase y no se pierden al volver a publicar la app.

## Probarla en tu computadora antes de publicar (opcional)

Copia `.dev.vars.example` a `.dev.vars` y rellena los 4 valores (mismos de arriba). Luego:

```bash
npm run dev
```

Abre `http://localhost:8787` en tu navegador. Ojo: esta copia local usa la **misma** base de datos de Supabase que la app publicada (no hay una base de datos local separada), así que cualquier cambio que hagas ahí también se guarda de verdad.

## Estructura del proyecto

```
loan-tracker/
├── wrangler.jsonc        # Configuración de Cloudflare (Worker)
├── src/
│   ├── index.ts          # API del servidor (rutas, autenticación)
│   ├── loanCalc.ts       # Cálculo de intereses, cuotas, saldo y estado
│   ├── db.ts             # Consultas a Supabase
│   ├── supabase.ts       # Conexión a Supabase (service_role)
│   └── auth.ts           # Contraseña y sesión firmada
└── public/
    ├── index.html         # Estructura de la página
    ├── styles.css         # Diseño visual (adaptable a celular y computadora)
    └── app.js              # Lógica de la aplicación (pantallas, formularios)
```

## Seguridad

- Los datos solo se pueden ver o modificar con la contraseña correcta.
- La sesión se guarda en una cookie firmada digitalmente (nadie puede fabricar una sesión válida sin conocer `AUTH_SECRET`).
- La cookie es `HttpOnly` (no accesible desde JavaScript en el navegador) y solo dura 30 días; si cierras sesión o pasa ese tiempo, hay que volver a poner la contraseña.
- Las tablas en Supabase tienen Row Level Security (RLS) activado sin reglas públicas: solo el servidor (con la `service_role` key) puede leer o escribir. Esa llave nunca se envía al navegador — vive únicamente como secreto dentro de Cloudflare.
- `APP_PASSWORD`, `AUTH_SECRET` y `SUPABASE_SERVICE_ROLE_KEY` son secretos: nunca los compartas ni los subas a ningún repositorio público.

## Actualización: cuotas por mes

Antes de publicar esta versión, ejecuta `migrations/20260923_payment_installment.sql` en el SQL Editor del proyecto Supabase que usa la app. Luego despliega el Worker. Sin esta columna nueva el registro de pagos fallará.

La primera cuota vence un mes después de `start_date`; para fechas como el 31, el vencimiento se ajusta al último día del mes. El sistema propone la cuota pendiente más antigua. Al registrar, eliges el mes y ves cómo se reparte el monto entre esa cuota y las siguientes; admite pagos parciales y varias cuotas en un solo pago. Guarda por separado el día del cobro y el número de la primera cuota a la que se aplica. En el detalle aparecen el calendario y los meses cubiertos por cada pago.

Ejemplo: una cuota que vence en agosto y se cobra en septiembre queda registrada con fecha de cobro en septiembre y cuota de agosto. Las cuotas vencidas y todavía pendientes determinan el atraso actual. Los pagos anteriores se aplican cronológicamente a las cuotas más antiguas porque antes no se guardaba su mes; revisa manualmente los casos históricos que se habían atribuido a un mes distinto.

### Estado visual de cada cuota

El calendario muestra **Pagado** cuando la cuota está cubierta, **Pago parcial** si aún no vence, **Pago parcial · atrasado** si ya venció, **Atrasado** si venció sin pago y **Pendiente** para cuotas futuras sin pago. Los contadores y las barras se recalculan automáticamente después de registrar o eliminar un pago. Esta mejora visual no necesita otra migración SQL además de la incluida en este ZIP.

### Portal del cliente (solo lectura)

El enlace del cliente muestra para cada préstamo el calendario de cuotas con estados y avance, la nota del préstamo y un historial con fecha de cobro, mes aplicado, monto y nota de cada pago. El token del enlace solo habilita el GET de su propio portal; los endpoints que crean, editan o eliminan datos siguen protegidos por la sesión del dueño. No hay botones de edición en el portal. Esta mejora no requiere una migración adicional.

### Compatibilidad cuando falta la columna de cuota

Si la tabla de pagos todavía no tiene `installment_number`, el servidor detecta exclusivamente ese error y guarda el mes seleccionado junto con el pago en un formato interno dentro de `notes`. Al consultar el préstamo, el historial y el portal, recupera el número de cuota y muestra únicamente la nota que escribiste. Si después ejecutas la migración SQL, los pagos anteriores siguen leyéndose correctamente y los nuevos usarán la columna. Para este ZIP, la migración deja de ser obligatoria para registrar pagos.

Ejemplo: cuota de agosto $900, pago de $1,400 aplicado desde agosto → agosto queda pagado y $500 se abonan a septiembre. El calendario, el saldo y el portal se recalculan a partir del mismo registro.

## Extensiones de préstamos

En la ficha del préstamo, **+ Agregar extensión** permite registrar el plazo e interés del acuerdo original, los meses e interés adicionales, la base del nuevo interés (capital original o capital pendiente) y la fecha del acuerdo. Se muestra una vista previa antes de guardar. No se entrega capital adicional: el préstamo conserva su principal y todos los pagos existentes. El portal de solo lectura también muestra las dos etapas.

Ejemplo: $5,000 del 15 de julio de 2026 al 40% por cinco meses ($2,000 de interés), más cinco meses al 40% sobre los mismos $5,000 ($2,000 extra): total $9,000. Las cuotas originales de agosto a diciembre son $1,400 cada una y las cinco cuotas adicionales de enero a mayo son $400 cada una. Si ya se cobró $1,400, el saldo total nuevo es $7,600; el pago conserva el mes al que se aplicó. La app no convierte retroactivamente las diez cuotas en $900, porque eso cambiaría lo pactado para los primeros cinco meses.

Si el préstamo ya estaba registrado como **80% / 10 meses**, al abrir la extensión se proponen **40% / 5 meses** originales y **40% / 5 meses** adicionales. Revisa la vista previa antes de guardar. Si eliges el capital pendiente, el interés adicional se calcula una sola vez al momento del acuerdo, siguiendo la regla actual de la app que aplica los pagos primero al interés original y luego al capital.

Cada préstamo permite agregar una extensión y eliminarla para volver al acuerdo original. Para registrar otra extensión, elimina la anterior y revisa el calendario antes de guardar la nueva. Después de registrarla, las condiciones y fechas quedan protegidas; la nota puede seguir editándose. La extensión se guarda con la nota del préstamo en un formato interno compatible con la base actual, así que no requiere otra migración. El cliente ve la nota normal, nunca el formato interno.

## Plan de cobro: primero interés y después capital

Desde la ficha del préstamo usa **Plan interés → capital**, indica cuántos meses quieres cobrar el interés y revisa la vista previa. El total y los pagos ya recibidos permanecen iguales; el calendario cambia la distribución mensual y muestra el concepto de cada cuota. Los centavos se reparten para que la suma cierre exactamente. El historial y el portal del cliente muestran cuánto de cada pago fue a interés y cuánto a capital. Mientras haya una cuota de interés pendiente, los pagos nuevos comienzan por la primera cuota de interés sin completar; si sobra dinero se aplica a las siguientes cuotas y luego al capital.

Ejemplo de Ángela con extensión pactada: capital $5,000, interés original $2,000, interés adicional $2,000, diez meses desde el 15 de julio. Si eliges **3 meses de interés**, las cuotas de agosto a octubre suman $4,000 de interés (una de $1,333.34 y dos de $1,333.33); las de noviembre a mayo suman $5,000 de capital (cuatro de $714.29 y tres de $714.28). Un pago de $1,400 aplicado desde agosto cubre agosto y deja $66.66 abonados a septiembre. El saldo del préstamo sigue siendo $9,000 menos todos los pagos recibidos.

Cambiar el plan recalcula los meses cubiertos por los pagos históricos sin editar sus fechas, montos ni notas. Si ya existen pagos atribuidos a meses de capital mientras queda interés sin pagar, el servidor rechaza el cambio para que no quede un calendario contradictorio. Esta función usa el formato interno de notas del préstamo y no requiere cambios en Supabase.

### Consultar una extensión ya registrada

La ficha del préstamo muestra **+ Agregar extensión** y **Eliminar extensión**. En la ficha de cada cliente también aparece la acción correspondiente junto a cada préstamo. Los datos de la extensión muestran ambos intereses, meses, fecha del acuerdo, base de cálculo y saldo, además del plan de interés y capital si existe. Registrar el plan no elimina ni reemplaza la extensión. Cuando hay un plan activo, la ficha describe las condiciones de la extensión sin llamar “cuota adicional” a una cuota que el nuevo calendario atribuye al capital.

### Acción opcional para extender

El préstamo conserva sus condiciones originales hasta que el cliente solicite más tiempo. Entonces el dueño pulsa **+ Agregar extensión**, revisa los meses y el interés adicional, y guarda el acuerdo. Si necesita volver al acuerdo original, pulsa **Eliminar extensión** y confirma. Si hay pagos atribuidos a meses adicionales o superiores al total original, el servidor explica el problema y conserva la extensión hasta resolverlo. Esta acción no se ejecuta automáticamente al crear un préstamo ni al configurar el plan de interés y capital.
