import type { StockLensApi } from '@shared/api'

export type { StockLensApi }

declare global {
  interface Window {
    api: StockLensApi
  }
}
