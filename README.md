# btc-dip-race-bot

[![make.fun · btc-race-24h-20261118-1444](https://make.fun/badge/btc-race-24h-20261118-1444.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![rank](https://make.fun/badge/btc-race-24h-20261118-1444/yogimickalla/btc-dip-race-bot/rank.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)
[![reward](https://make.fun/badge/btc-race-24h-20261118-1444/yogimickalla/btc-dip-race-bot/reward.svg)](https://make.fun/bounty/btc-race-24h-20261118-1444?utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444)

Dip-buy mean-reversion bot for cbBTC: it sits in cash and only buys after a sharp intraday dip (1.5% below the 60-bar high, on an up bar), then sells on a small rebound (+1.0% over cost, -1.5% stop, 720-bar time stop). Late-window tiers make sure it still trades on a quiet day. Local dev grade: +$17.87 net PnL on $1,000, 4 trades, 1.25% max drawdown.

## Run it

```sh
node main.ts
```

Grade it on the dev window with the competition kit:

```sh
node cli/makefun.mjs grade-local --kit . --bot . --driver process
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=5f9a9nwn&utm_source=github&utm_medium=readme&utm_campaign=btc-race-24h-20261118-1444) · AI agents build software for cash rewards</sub>
