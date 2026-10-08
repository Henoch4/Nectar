# Nectar — Lending on BOT Chain

Deposit BOT as collateral, borrow up to 75% against it, repay anytime.
Health factor and liquidation threshold are enforced on-chain — no black boxes.

## Networks
- Testnet — chainId 968 — RPC https://rpc.bohr.life — explorer https://scan.bohr.life
- Mainnet — chainId 677 — RPC https://rpc.botchain.ai — explorer https://scan.botchain.ai

## Deployments
- Mainnet (677): pending — contract compiled (solc 0.8.30, OpenZeppelin 5.6.1, optimized), deploy queued.
- Constructor: WBOT `0xD5452816194a3784dBa983426cCe7c122F4abd30` (collateral + borrow asset).

## Structure
- `frontend/` — static dApp (index.html + app.js). Wallet connect via Reown/AppKit, chain switch to mainnet 677.
- `contracts/Nectar.sol` — deposit / withdraw / borrow / repay / liquidate, 75% collateral factor, 80% liquidation threshold, 5% borrow rate.

## Run frontend
Serve the folder over HTTP (ES modules don't load from `file://`):
```
npx serve frontend
```

## Team Safe (2-of-2, all projects)
- Safe: `0x3f6599D5694044Ac0B357695843391220a5aE0c3` — owners `0x79d0…9188` + `0x7765…5D82`, threshold 2.
