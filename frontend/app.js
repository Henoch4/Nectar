import * as ethers from 'ethers';
import { createAppKit } from '@reown/appkit';
import { EthersAdapter } from '@reown/appkit-adapter-ethers';

const PROJECT_ID = 'f018499b1e4a94d961ab67aeeeff3254';

const botTestnet = {
  id: 968, chainNamespace: 'eip155', caipNetworkId: 'eip155:968',
  name: 'BOT Chain Testnet',
  nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.bohr.life'] } },
  blockExplorers: { default: { name: 'BOT Scan', url: 'https://scan.bohr.life' } },
};
const botMainnet = {
  id: 677, chainNamespace: 'eip155', caipNetworkId: 'eip155:677',
  name: 'BOT Chain',
  nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.botchain.ai'] } },
  blockExplorers: { default: { name: 'BOT Scan', url: 'https://scan.botchain.ai' } },
};

const modal = createAppKit({
  adapters: [new EthersAdapter()],
  networks: [botTestnet, botMainnet],
  defaultNetwork: botMainnet,
  projectId: PROJECT_ID,
  metadata: { name: 'Nectar', description: 'Lending protocol on BOT Chain', url: location.origin, icons: [location.origin + '/logo.png'] },
  themeVariables: { '--w3m-accent': '#10b981' },
  features: { analytics: false },
});

let signer = null;
let account = null;
let walletProvider = null;
let _connectResolve = null;

const $ = (id) => document.getElementById(id);

function getProvider() {
  if (walletProvider) return walletProvider;
  try {
    if (modal && typeof modal.getWalletProvider === 'function') {
      const p = modal.getWalletProvider('eip155') || modal.getWalletProvider();
      if (p) { walletProvider = p; return p; }
    }
  } catch (e) {}
  return null;
}

async function syncFromProvider(wp) {
  let bp = new ethers.BrowserProvider(wp);
  signer = await bp.getSigner();
  account = await signer.getAddress();
  $('connectBtn').textContent = account.slice(0, 6) + '...' + account.slice(-4);
  console.log('[Nectar] Wallet connected:', account);
  if (typeof refreshReads === 'function') refreshReads();
}

function updateConnectedUI() {
  $('connectBtn').textContent = account ? account.slice(0, 6) + '...' + account.slice(-4) : 'Connect wallet';
}

function updateDisconnectedUI() {
  $('connectBtn').textContent = 'Connect wallet';
}

async function connect() {
  try {
    if (modal.getIsConnectedState()) {
      const wp = getProvider();
      if (wp) {
        await syncFromProvider(wp);
        updateConnectedUI();
        return true;
      }
    }
  } catch (err) {}
  const pending = new Promise((resolve) => { _connectResolve = resolve; });
  try { modal.open(); } catch (err) { _connectResolve = null; return false; }
  const timeout = new Promise((resolve) => setTimeout(() => resolve(!!signer), 120000));
  return Promise.race([pending, timeout]);
}

function onConnectClick() {
  let isConn = false;
  try { isConn = modal.getIsConnectedState(); } catch (e) {}
  if (isConn && getProvider()) {
    try { modal.open({ view: 'Account' }); } catch (e) { try { modal.open(); } catch (_) {} }
    return;
  }
  connect();
}

modal.subscribeProviders((state) => {
  if (state && state['eip155']) walletProvider = state['eip155'];
});

modal.subscribeAccount(async (state) => {
  if (state && state.isConnected && state.address) {
    account = state.address;
    const wp = getProvider();
    if (wp) {
      try {
        await syncFromProvider(wp);
        updateConnectedUI();
      } catch (e) {}
    }
    if (_connectResolve) { _connectResolve(!!signer); _connectResolve = null; }
  } else {
    const was = !!account;
    account = null; signer = null;
    updateDisconnectedUI();
    if (was) console.log('[Nectar] disconnected');
    if (_connectResolve) { _connectResolve(false); _connectResolve = null; }
  }
});

modal.subscribeState((state) => {
  if (state && state.open === false && _connectResolve && !signer) {
    _connectResolve(false); _connectResolve = null;
  }
});

document.addEventListener('DOMContentLoaded', () => {
  $('connectBtn').addEventListener('click', (e) => { e.preventDefault(); onConnectClick(); });
  $('netSel').addEventListener('change', (e) => {
    const id = parseInt(e.target.value);
    modal.switchNetwork(id === 677 ? botMainnet.caipNetworkId : botTestnet.caipNetworkId);
  });
  setTimeout(async () => {
    try {
      if (!signer && modal.getIsConnectedState()) {
        const wp = getProvider();
        if (wp) {
          await syncFromProvider(wp);
          updateConnectedUI();
        }
      }
    } catch (e) {}
  }, 800);
});

// ---- mainnet contract (BOT Chain 677) ----
const WBOT = '0xD5452816194a3784dBa983426cCe7c122F4abd30';
const CONTRACT_ADDR = '0x9A6613d0A124dAA6280115D97A9cb01cB3F88B92';
const GAS = { gasPrice: ethers.parseUnits('20', 'gwei') };
const readProvider = new ethers.JsonRpcProvider('https://rpc.botchain.ai');
const NECTAR_ABI = [
  'function totalDeposits() view returns (uint256)',
  'function totalBorrows() view returns (uint256)',
  'function deposits(address) view returns (uint256)',
  'function borrows(address) view returns (uint256)',
  'function debtOf(address) view returns (uint256)',
  'function borrowInterest(address) view returns (uint256)',
  'function pendingLenderReward(address) view returns (uint256)',
  'function claimLenderReward()',
  'function getHealthFactor(address) view returns (uint256)',
  'function deposit(uint256)',
  'function withdraw(uint256)',
  'function borrow(uint256)',
  'function repay(uint256)',
];
const ERC20_ABI = [
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
  'function deposit() payable',
  'function balanceOf(address) view returns (uint256)',
];
const fmtBot = (v) => {
  const n = Number(ethers.formatEther(v));
  if (n === 0) return '0 BOT';
  if (n >= 10000) return Math.round(n).toLocaleString() + ' BOT';
  if (n >= 1) return n.toFixed(3) + ' BOT';
  return n.toFixed(5) + ' BOT';
};

function nectarRead() { return new ethers.Contract(CONTRACT_ADDR, NECTAR_ABI, readProvider); }

async function refreshReads() {
  try {
    const c = nectarRead();
    const [td, tb] = await Promise.all([c.totalDeposits(), c.totalBorrows()]);
    $('statTVL').textContent = fmtBot(td);
    $('statBorrows').textContent = fmtBot(tb);
    if (account) {
      const [d, debt, interest, rew, hf] = await Promise.all([c.deposits(account), c.debtOf(account), c.borrowInterest(account), c.pendingLenderReward(account), c.getHealthFactor(account)]);
      $('yourDeposit').textContent = fmtBot(d);
      $('yourBorrow').textContent = fmtBot(debt);
      $('riskCollateral').textContent = fmtBot(d);
      $('riskDebt').textContent = fmtBot(debt);
      $('yourInterest').textContent = fmtBot(interest);
      $('yourRewards').textContent = fmtBot(rew);
      if (debt === 0n) {
        $('healthFactor').textContent = 'infinite';
        $('healthFill').style.width = '100%';
        $('healthFill').classList.remove('danger');
      } else {
        const pct = Number(hf);
        $('healthFactor').textContent = pct + '%';
        $('healthFill').style.width = Math.min(100, Math.round(pct / 2)) + '%';
        $('healthFill').classList.toggle('danger', pct < 100);
      }
    } else {
      $('yourDeposit').textContent = 'connect wallet';
      $('yourBorrow').textContent = 'connect wallet';
      $('riskCollateral').textContent = '—';
      $('riskDebt').textContent = '—';
      $('yourInterest').textContent = '—';
      $('yourRewards').textContent = '—';
      $('healthFactor').textContent = '—';
      $('healthFill').style.width = '0%';
    }
  } catch (e) { console.error('[Nectar] reads failed', e); }
}

async function requireWallet() {
  if (signer && account) return true;
  const ok = await connect();
  return !!(ok && signer && account);
}

async function ensureWbot(amount) {
  const t = new ethers.Contract(WBOT, ERC20_ABI, signer);
  const bal = await t.balanceOf(account);
  if (bal >= amount) return;
  const shortfall = amount - bal;
  const native = await signer.provider.getBalance(account);
  const gasCost = ethers.parseEther('0.005');
  if (native < shortfall + gasCost) throw new Error('Need ' + fmtBot(shortfall + gasCost - native) + ' more BOT (wrap + gas)');
  const tx = await t.deposit({ value: shortfall, ...GAS });
  await tx.wait();
}

async function approveIfNeeded(amount) {
  const t = new ethers.Contract(WBOT, ERC20_ABI, signer);
  const a = await t.allowance(account, CONTRACT_ADDR);
  if (a < amount) {
    const tx = await t.approve(CONTRACT_ADDR, ethers.MaxUint256, GAS);
    await tx.wait();
  }
}

async function runTx(btn, label, fn) {
  if (!(await requireWallet())) return;
  const old = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Confirm in wallet…';
  try {
    const tx = await fn();
    btn.textContent = 'Pending…';
    await tx.wait();
    btn.textContent = '✓ ' + label;
    await refreshReads();
  } catch (e) {
    console.error('[Nectar]', label, e);
    btn.textContent = '✗ ' + String(e.shortMessage || e.reason || e.message || 'failed').slice(0, 50);
  }
  setTimeout(() => { btn.textContent = old; btn.disabled = false; }, 3500);
}

function parseAmt(input) {
  try {
    const v = ethers.parseUnits((input.value || '').trim() || '0', 18);
    return v > 0n ? v : null;
  } catch { return null; }
}

function amtGuard(btn, text) {
  btn.textContent = text;
  setTimeout(() => { btn.textContent = btn.dataset.label || btn.textContent; }, 1500);
}

document.addEventListener('DOMContentLoaded', () => {
  $('contractAddr').textContent = CONTRACT_ADDR;
  refreshReads();
  setInterval(refreshReads, 30000);

  const wire = (id, label) => { const b = $(id); b.dataset.label = b.textContent; return b; };
  const depBtn = wire('depBtn'), borrowBtn = wire('borrowBtn'), repayBtn = wire('repayBtn'), wdBtn = wire('wdBtn'), claimBtn = wire('claimBtn');

  depBtn.addEventListener('click', () => {
    const amt = parseAmt($('depAmt'));
    if (!amt) { amtGuard(depBtn, 'Enter amount'); return; }
    runTx(depBtn, 'Deposited', async () => {
      await ensureWbot(amt);
      await approveIfNeeded(amt);
      return nectarRead().connect(signer).deposit(amt, GAS);
    });
  });
  borrowBtn.addEventListener('click', () => {
    const amt = parseAmt($('borrowAmt'));
    if (!amt) { amtGuard(borrowBtn, 'Enter amount'); return; }
    runTx(borrowBtn, 'Borrowed', () => nectarRead().connect(signer).borrow(amt, GAS));
  });
  repayBtn.addEventListener('click', () => {
    const amt = parseAmt($('repayAmt'));
    if (!amt) { amtGuard(repayBtn, 'Enter amount'); return; }
    runTx(repayBtn, 'Repaid', async () => {
      await approveIfNeeded(amt);
      return nectarRead().connect(signer).repay(amt, GAS);
    });
  });
  wdBtn.addEventListener('click', () => {
    const amt = parseAmt($('wdAmt'));
    if (!amt) { amtGuard(wdBtn, 'Enter amount'); return; }
    runTx(wdBtn, 'Withdrawn', () => nectarRead().connect(signer).withdraw(amt, GAS));
  });
  claimBtn.addEventListener('click', () => {
    runTx(claimBtn, 'Claimed', () => nectarRead().connect(signer).claimLenderReward(GAS));
  });
});
