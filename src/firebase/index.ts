import { initializeApp } from 'firebase/app'
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager
} from 'firebase/firestore'
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth'

const app = initializeApp({
  apiKey:     import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:  import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId:      import.meta.env.VITE_FIREBASE_APP_ID
})

export const firebaseApp = app

// Persistencia offline en IndexedDB: los chart_periods leídos se cachean y se
// sirven sin volver a leer de red en sesiones repetidas → clave para no agotar
// el límite de lecturas del plan Spark (50k/día) al regenerar radios.
// persistentMultipleTabManager evita conflictos entre pestañas.
export const firestore = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
})

export const auth = getAuth(app)

/**
 * Resuelve cuando hay un usuario autenticado (anónimo). Idempotente y con
 * unsubscribe tras el primer resultado (sin listener colgando).
 */
let authReady: Promise<void> | null = null

export function ensureAnonymousAuth(): Promise<void> {
  if (authReady) return authReady
  authReady = new Promise<void>((resolve, reject) => {
    const unsub = onAuthStateChanged(
      auth,
      async user => {
        try {
          if (!user) await signInAnonymously(auth)
          unsub()
          resolve()
        } catch (err) {
          unsub()
          reject(err as Error)
        }
      },
      err => { unsub(); reject(err) }
    )
  })
  return authReady
}
