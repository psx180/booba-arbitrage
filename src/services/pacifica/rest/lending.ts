import { z } from 'zod';
import { PacificaBaseClient } from '../client';
import { apiResponse } from '../types/common';

const LoanPoolRawSchema = z.object({
  total_borrowed: z.string(),
  total_borrowable: z.string(),
  utilization: z.string(),
  borrow_rate_apr: z.string(),
  borrow_rate_apy: z.string(),
  lend_rate_apr: z.string(),
  lend_rate_apy: z.string(),
  utilization_max: z.string(),
});

const SpotAssetRawSchema = z.object({
  symbol: z.string(),
  active: z.boolean(),
  collateral_enabled: z.boolean(),
  ltv_ratio: z.string(),
});

export interface LoanPool {
  total_borrowed: number;
  total_borrowable: number;
  utilization: number;
  borrow_rate_apr: number;
  borrow_rate_apy: number;
  lend_rate_apr: number;
  lend_rate_apy: number;
  utilization_max: number;
}

export interface SpotAsset {
  symbol: string;
  active: boolean;
  collateral_enabled: boolean;
  ltv_ratio: number;
}

export class LendingAPI {
  constructor(private client: PacificaBaseClient) {}

  /** Unified-margin borrow/lend pool state. */
  async getLoanPool(): Promise<LoanPool> {
    const res = await this.client.get(
      '/loan_pool',
      {},
      apiResponse(LoanPoolRawSchema),
    );
    return {
      total_borrowed: parseFloat(res.data.total_borrowed),
      total_borrowable: parseFloat(res.data.total_borrowable),
      utilization: parseFloat(res.data.utilization),
      borrow_rate_apr: parseFloat(res.data.borrow_rate_apr),
      borrow_rate_apy: parseFloat(res.data.borrow_rate_apy),
      lend_rate_apr: parseFloat(res.data.lend_rate_apr),
      lend_rate_apy: parseFloat(res.data.lend_rate_apy),
      utilization_max: parseFloat(res.data.utilization_max),
    };
  }

  /** Spot assets with collateral eligibility and LTV. */
  async getSpotAssets(): Promise<SpotAsset[]> {
    const res = await this.client.get(
      '/spot_assets',
      {},
      apiResponse(z.array(SpotAssetRawSchema)),
    );
    return res.data.map((a) => ({
      symbol: a.symbol,
      active: a.active,
      collateral_enabled: a.collateral_enabled,
      ltv_ratio: parseFloat(a.ltv_ratio),
    }));
  }
}
