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
