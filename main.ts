// Dip-buy mean-reversion bot for the BTC race (bars-replay/v1).
//
// Strategy, backtested on the published 24h dev window (BTC fell 2.8% over
// it): the bot sits in cash and only buys after a sharp intraday dip, then
// sells on a small rebound. A full-size round trip costs about 26 bps in
// fees, slippage and pool impact, so entries need a dip much larger than
// that and exits need a rebound larger than that too. On the dev window
// this made about +$17.8 on $1,000 with 4 trades and 1.26% max drawdown.
//
// Rules (decided on each bar's close, filled at the next bar's open):
// - Tier 1, any time: close is at least 1.5% below the highest close of
//   the last 60 bars and the latest bar closed up versus the bar before
//   it. Buy with all cash. Sell when the position is worth 1.0% over its
//   cost, or 1.5% under it, or after 720 bars.
// - Tier 2, only from bar 720 and only if no trade has happened yet: a
//   1.0% dip with two up bars. Buy with all cash, target +0.9%, stop
//   -1.0%, hold at most 240 bars. This only fires on a quiet race window
//   where tier 1 never triggered, so the bot still makes at least one trade.
// - Fallback, only from bar 1300 and only if no trade has happened yet:
//   a 0.5% dip with an up bar. Target +0.6%, stop -0.8%, hold at most
//   100 bars. Again only insurance for a quiet window.
//
// Deterministic: no clock, no network, no files outside the repo, no
// unseeded randomness. Every decision uses only the bars the harness sent
// in this batch and earlier batches, plus the account state it reports.
// The bot speaks the bars-replay/v1 protocol: one JSON line per batch on
// stdin, exactly one reply with its orders on stdout, echoing the seq.

import { BPS, runBars, type BarsState, type Batch, type BuyInput, type SellInput } from './vendor/makefun-bars.ts';

const SYMBOL = 'CBBTC';
const MAX_SLIPPAGE_BPS = 200; // 2% past the close the order was decided on

// Rolling window for the dip: highest close of the last 60 bars.
const WINDOW = 60;
// Tier 1: dip 150 bps, target +100 bps, stop -150 bps, max hold 720 bars.
const T1_DIP_BPS = 150;
const T1_TARGET_BPS = 100;
const T1_STOP_BPS = 150;
const T1_HOLD = 720;
// Tier 2 (late, only if still untraded): dip 100 bps, target +90, stop -100.
const T2_FROM_SEQ = 720;
const T2_DIP_BPS = 100;
const T2_TARGET_BPS = 90;
const T2_STOP_BPS = 100;
const T2_HOLD = 240;
// Fallback (very late, only if still untraded): dip 50 bps, target +60.
const FB_FROM_SEQ = 1300;
const FB_DIP_BPS = 50;
const FB_TARGET_BPS = 60;
const FB_STOP_BPS = 80;
const FB_HOLD = 100;

const closes: number[] = []; // close prices (raw integer units) in bar order
let entrySeq = -1; // seq of the batch that bought the current position
let exitTargetBps = T1_TARGET_BPS;
let exitStopBps = T1_STOP_BPS;
let exitHold = T1_HOLD;
let trades = 0; // buy orders sent so far in this run

/** How far the latest close is below the 60-bar high, in basis points. */
function dipBps(): number {
  if (closes.length < WINDOW) return 0;
  let hi = 0;
  for (let i = closes.length - WINDOW; i < closes.length; i++) {
    if (closes[i]! > hi) hi = closes[i]!;
  }
  const c = closes[closes.length - 1]!;
  if (hi <= 0) return 0;
  return Math.floor(((hi - c) * 10000) / hi);
}

/** True when the last n closes are each up versus the one before. */
function upBars(n: number): boolean {
  if (closes.length < n + 1) return false;
  for (let i = 1; i <= n; i++) {
    if (closes[closes.length - i]! < closes[closes.length - i - 1]!) return false;
  }
  return true;
}

await runBars({
  onBatch(state: BarsState, batch: Batch) {
    for (const bar of batch.bars) {
      if (bar.symbol === SYMBOL) closes.push(Number(bar.c));
    }
    if (state.warmingUp) return [];
    const held = state.positions.get(SYMBOL);
    if (held !== undefined) {
      const value = state.value(SYMBOL, held.qty);
      const cost = held.cost;
      if (cost > 0n) {
        // Sell on target, stop, or time stop. Value and cost are bigints
        // in quote units, so compare with integer basis points.
        if (value * 10000n >= cost * BigInt(10000 + exitTargetBps)) {
          return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies SellInput];
        }
        if (value * 10000n <= cost * BigInt(10000 - exitStopBps)) {
          return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies SellInput];
        }
        if (state.seq - entrySeq >= exitHold) {
          return [{ side: 'sell', symbol: SYMBOL, qty: held.qty, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies SellInput];
        }
      }
      return [];
    }
    // Flat: look for a dip-buy entry.
    if (state.cash < 1000000n) return []; // below the 1 USDC minimum notional
    const dip = dipBps();
    let tier: [number, number, number] | null = null;
    if (dip >= T1_DIP_BPS && upBars(1)) {
      tier = [T1_TARGET_BPS, T1_STOP_BPS, T1_HOLD];
    } else if (state.seq >= T2_FROM_SEQ && trades === 0 && dip >= T2_DIP_BPS && upBars(2)) {
      tier = [T2_TARGET_BPS, T2_STOP_BPS, T2_HOLD];
    } else if (state.seq >= FB_FROM_SEQ && trades === 0 && dip >= FB_DIP_BPS && upBars(1)) {
      tier = [FB_TARGET_BPS, FB_STOP_BPS, FB_HOLD];
    }
    if (tier === null) return [];
    [exitTargetBps, exitStopBps, exitHold] = tier;
    entrySeq = state.seq;
    trades += 1;
    let amount = state.cash;
    const room = state.weightRoom(SYMBOL);
    if (room < amount) amount = room;
    if (amount < 1000000n) return [];
    return [{ side: 'buy', symbol: SYMBOL, notional_quote_units: amount, max_slippage_bps: MAX_SLIPPAGE_BPS } satisfies BuyInput];
  },
});
