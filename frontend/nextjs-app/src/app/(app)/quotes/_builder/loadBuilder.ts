import 'server-only'

import { unstable_rethrow } from 'next/navigation'
import { serverApi } from '@/lib/api/server'
import { errorText } from '@/lib/api/types'
import { quoteBuilderService } from '@/services/quoteBuilderService'
import type { BuilderData } from './QuoteBuilder'

/** Settles a read: its data, or the fallback plus an error message. A 401 redirect is rethrown. */
async function settle<T>(read: Promise<T>, fallback: T, message: string): Promise<[T, string | null]> {
  try {
    return [await read, null]
  } catch (e) {
    unstable_rethrow(e)
    return [fallback, errorText(e, message)]
  }
}

/** Server-side: the builder's clients and products, plus the draft when editing (id). */
export async function loadBuilder(id?: string): Promise<BuilderData> {
  const api = await serverApi()
  const [[products, productsError], [clients, clientsError], [quote, quoteError]] = await Promise.all([
    settle(quoteBuilderService.listProducts(api), [], 'Could not load products'),
    settle(quoteBuilderService.listClients(api), [], 'Could not load clients'),
    id ? settle(quoteBuilderService.get(id, api), null, 'Could not load quotation') : Promise.resolve([null, null] as const),
  ])
  return { clients, products, quote, error: quoteError ?? clientsError ?? productsError }
}
