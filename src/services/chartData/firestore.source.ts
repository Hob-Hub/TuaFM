import { collection, query, where, getDocs, doc, getDoc } from 'firebase/firestore'
import { getFirestoreDb } from '@/firebase/index'
import type { ChartPeriod, ChartRegistry } from '@/types/chart.types'

/**
 * Fuente de charts respaldada por Firestore (colecciones chart_registry +
 * chart_periods). Es la fuente de respaldo / para charts no incluidos en el
 * bundle estático. Sus lecturas consumen cuota del plan Spark, por eso la capa
 * combinada (index.ts) prefiere el estático cuando el chart existe localmente.
 */

export async function listRegistries(): Promise<ChartRegistry[]> {
  const snap = await getDocs(collection(getFirestoreDb(), 'chart_registry'))
  return snap.docs.map(d => d.data() as ChartRegistry)
}

export async function getRegistry(chartId: string): Promise<ChartRegistry | null> {
  const snap = await getDoc(doc(getFirestoreDb(), 'chart_registry', chartId))
  return snap.exists() ? (snap.data() as ChartRegistry) : null
}

export async function getPeriods(
  chartId: string, minYear: number, maxYear: number
): Promise<ChartPeriod[]> {
  const q = query(
    collection(getFirestoreDb(), 'chart_periods'),
    where('chartId', '==', chartId),
    where('year', '>=', minYear),
    where('year', '<=', maxYear)
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => d.data() as ChartPeriod)
}
