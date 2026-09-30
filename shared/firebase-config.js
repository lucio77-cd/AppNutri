// shared/firebase-config.js
//
// Inicializa o Firebase e exporta `db` (Firestore) e `auth` (Authentication)
// para serem usados em qualquer outra página/arquivo do app.
//
// COMO USAR:
// Em qualquer HTML que precise do Firebase, inclua:
//   <script type="module" src="/shared/firebase-config.js"></script>
// E em qualquer outro arquivo .js que precise do db/auth, importe assim:
//   import { db, auth, UID_NUTRICIONISTA } from "/shared/firebase-config.js";
//
// IMPORTANTE: todo arquivo que faz import/export precisa ser carregado como
// <script type="module">, senão o navegador não entende o import.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDUSSCIyY_mgtxNh2aZIsoQ0bLCpw_BBo0",
  authDomain: "app-nutri-edd78.firebaseapp.com",
  projectId: "app-nutri-edd78",
  storageBucket: "app-nutri-edd78.firebasestorage.app",
  messagingSenderId: "1019966010776",
  appId: "1:1019966010776:web:f3502ca4e4cef60ff127ed",
};

// ============================================================
// TODO: cole aqui o UID da sua irmã no Firebase Authentication.
// Vem no próximo passo (depois de criar a conta dela em Authentication > Users).
//
// ATENÇÃO: esse mesmo UID também precisa estar, IGUALZINHO, dentro do
// firestore.rules (na função isNutri()). Se recriar a conta e o UID mudar,
// atualize nos DOIS lugares.
// ============================================================
export const UID_NUTRICIONISTA = "COLE_AQUI_O_UID_DA_IRMA";

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
