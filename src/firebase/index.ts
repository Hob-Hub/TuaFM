import { initializeApp, type FirebaseApp } from 'firebase/app'
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  type Firestore
} from 'firebase/firestore'
import { getAuth, signInAnonymously, onAuthStateChanged, type Auth } from 'firebase/auth'

const config = {
  apiKey:     import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:  import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId:      import.meta.env.VITE_FIREBASE_APP_ID
}

/**
 * ¿Hay configuración mínima de Firebase? Si no, la app corre 100% local
 * (charts estáticos + Dexie + APIs externas) sin tocar Firebase. Importante:
 * la inicialización es PEREZOSA — importar este módulo nunca lanza, así un
 * .env ausente o inválido no tumba el arranque (bug auth/invalid-api-key).
 */
export const isFirebaseConfigured = Boolean(config.apiKey && config.projectId)

let app: FirebaseApp | null = null
let firestoreInstance: Firestore | null = null
let authInstance: Auth | null = null

function getApp(): FirebaseApp {
  if (!isFirebaseConfigured) throw new Error('[firebase] sin configurar (faltan VITE_FIREBASE_*)')
  if (!app) app = initializeApp(config)
  return app
}

/**
 * Firestore con persistencia offline en IndexedDB: los chart_periods y el
 * track_cache leídos se cachean y se sirven sin volver a leer de red en
 * sesiones repetidas → clave para no agotar el límite de lecturas del plan
 * Spark (50k/día). persistentMultipleTabManager evita conflictos entre pestañas.
 * Lanza si Firebase no está configurado; los llamadores lo capturan y degradan.
 */
export function getFirestoreDb(): Firestore {
  if (!firestoreInstance) {
    firestoreInstance = initializeFirestore(getApp(), {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    })
  }
  return firestoreInstance
}

function getAuthInstance(): Auth {
  if (!authInstance) authInstance = getAuth(getApp())
  return authInstance
}

/**
 * Resuelve cuando hay un usuario autenticado (anónimo). Idempotente y con
 * unsubscribe tras el primer resultado (sin listener colgando). Rechaza sin
 * efectos si Firebase no está configurado.
 */
let authReady: Promise<void> | null = null

export function ensureAnonymousAuth(): Promise<void> {
  if (authReady) return authReady
  authReady = new Promise<void>((resolve, reject) => {
    let auth: Auth
    try {
      auth = getAuthInstance()
    } catch (err) {
      authReady = null
      reject(err as Error)
      return
    }
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
