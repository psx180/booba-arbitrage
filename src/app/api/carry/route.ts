import type { NextRequest } from 'next/server';
import { fetchCarryAnalysis } from '@/lib/carry-data';

export async function GET(request: NextRequest) {
  const symbol = request.nextUrl.searchParams.get('symbol') ?? 'SOL';

  try {
    const analysis = await fetchCarryAnalysis(symbol);
    return Response.json(analysis);
  } catch (error) {
    console.error('[carry] Analysis failed:', error);
    const message = error instanceof Error ? error.message : 'Analysis failed';
    return Response.json({ error: message }, { status: 500 });
  }
}
