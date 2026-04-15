const core = window.FashionStoreCore;

// ── light particle background ───────────────────────────
const canvas = document.getElementById("bgCanvas");
const ctx = canvas?.getContext("2d");
let W = 0, H = 0, particles = [], mouse = { x: -9999, y: -9999 };

const PARTICLE_COUNT = 56;
const LINE_DIST = 150;
const PARTICLE_SPEED = 0.18;

function resizeCanvas() {
  if (!canvas) return;
  W = canvas.width = window.innerWidth;
  H = canvas.height = window.innerHeight;
}

function randomBetween(a, b) {
  return a + Math.random() * (b - a);
}

function initParticles() {
  particles = Array.from({ length: PARTICLE_COUNT }, () => ({
    x: randomBetween(0, W),
    y: randomBetween(0, H),
    vx: randomBetween(-PARTICLE_SPEED, PARTICLE_SPEED),
    vy: randomBetween(-PARTICLE_SPEED, PARTICLE_SPEED),
    r: randomBetween(1.2, 2.2),
    opacity: randomBetween(0.28, 0.9)
  }));
}

function drawFrame() {
  if (!ctx || !canvas) return;
  ctx.clearRect(0, 0, W, H);

  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    if (p.x < 0) p.x = W;
    if (p.x > W) p.x = 0;
    if (p.y < 0) p.y = H;
    if (p.y > H) p.y = 0;

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(45, 108, 223, ${p.opacity * 0.36})`;
    ctx.fill();
  }

  for (let i = 0; i < particles.length; i++) {
    const a = particles[i];

    const mdx = mouse.x - a.x;
    const mdy = mouse.y - a.y;
    const mouseDist = Math.sqrt(mdx * mdx + mdy * mdy);
    if (mouseDist < 180) {
      const alpha = (1 - mouseDist / 180) * 0.16;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(mouse.x, mouse.y);
      ctx.strokeStyle = `rgba(123, 169, 255, ${alpha})`;
      ctx.lineWidth = 0.9;
      ctx.stroke();
    }

    for (let j = i + 1; j < particles.length; j++) {
      const b = particles[j];
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < LINE_DIST) {
        const alpha = (1 - dist / LINE_DIST) * 0.13;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.strokeStyle = `rgba(45, 108, 223, ${alpha})`;
        ctx.lineWidth = 0.7;
        ctx.stroke();
      }
    }
  }

  requestAnimationFrame(drawFrame);
}

window.addEventListener("resize", () => {
  resizeCanvas();
  initParticles();
});
window.addEventListener("mousemove", (event) => {
  mouse.x = event.clientX;
  mouse.y = event.clientY;
});

resizeCanvas();
initParticles();
requestAnimationFrame(drawFrame);

// ── entry runtime ───────────────────────────────────────
const dom = {
  connectButton: document.getElementById("connectBtn"),
  connectButtonConnected: document.getElementById("connectBtnConnected"),
  switchNetworkButton: document.getElementById("switchNetBtn"),
  switchNetworkButtonConnected: document.getElementById("switchNetBtnConnected"),
  statusDot: document.getElementById("statusDot"),
  statusText: document.getElementById("statusText"),
  statusTime: document.getElementById("statusTime"),
  chainBadge: document.getElementById("chainBadge"),
  walletAddr: document.getElementById("walletAddr"),
  walletNetwork: document.getElementById("walletNetwork"),
  walletSessionState: document.getElementById("walletSessionState"),
  walletRole: document.getElementById("walletRole"),
  walletContract: document.getElementById("walletContract"),
  walletEscrow: document.getElementById("walletEscrow"),
  notConnectedState: document.getElementById("notConnectedState"),
  connectedState: document.getElementById("connectedState"),
  networkNotice: document.getElementById("networkNotice"),
  blockNumber: document.getElementById("blockNumber"),
  entryFooterRole: document.getElementById("entryFooterRole"),
  enterStoreBtn: document.getElementById("enterStoreBtn"),
  toast: document.getElementById("toastEntry")
};

const state = {
  account: null,
  chainId: null,
  session: null
};

function showToast(message, duration = 2600) {
  if (!dom.toast) return;
  dom.toast.textContent = message;
  dom.toast.style.display = "block";
  window.clearTimeout(dom.toast._timer);
  dom.toast._timer = window.setTimeout(() => {
    dom.toast.style.display = "none";
  }, duration);
}

function normalizeError(error) {
  return String(error?.reason || error?.shortMessage || error?.message || "發生未知錯誤")
    .replace(/^execution reverted:\s*/, "");
}

function tickClock() {
  if (dom.statusTime) {
    dom.statusTime.textContent = new Date().toLocaleTimeString("zh-Hant", { hour12: false });
  }
}

function setStatus(text, active = false) {
  if (dom.statusText) dom.statusText.textContent = text;
  if (dom.statusDot) dom.statusDot.classList.toggle("active", active);
}

function getRoleLabel(session) {
  if (!session?.authenticated) return "訪客";
  if (session?.isAdmin) return "Owner / Admin";
  if (session?.sellerStatus === "approved") return "已核准賣家";
  if (session?.sellerStatus === "pending") return "賣家審核中";
  return "已登入買家";
}

async function refreshBlockNumber() {
  if (!dom.blockNumber) return;
  try {
    const provider = await core.ensureProvider();
    const blockNumber = await provider.getBlockNumber();
    dom.blockNumber.textContent = `Block #${blockNumber}`;
  } catch {
    dom.blockNumber.textContent = "Block #—";
  }
}

async function refreshEscrowStatus() {
  const contractAddress = core.getConfiguredContractAddress();
  if (dom.walletContract) {
    dom.walletContract.textContent = contractAddress ? core.formatAddress(contractAddress) : "未設定";
  }

  if (!contractAddress || !dom.walletEscrow) {
    if (dom.walletEscrow) dom.walletEscrow.textContent = "—";
    return;
  }

  try {
    const contract = await core.ensureContract();
    const balance = await contract.get_contract_balance();
    dom.walletEscrow.textContent = core.formatEth(balance);
  } catch {
    dom.walletEscrow.textContent = "—";
  }
}

function applyDisconnectedState() {
  state.account = null;
  state.chainId = null;
  state.session = null;

  if (dom.notConnectedState) dom.notConnectedState.style.display = "grid";
  if (dom.connectedState) dom.connectedState.style.display = "none";
  if (dom.chainBadge) dom.chainBadge.textContent = "未連接";
  if (dom.walletAddr) dom.walletAddr.textContent = "—";
  if (dom.walletNetwork) dom.walletNetwork.textContent = "—";
  if (dom.walletSessionState) dom.walletSessionState.textContent = "尚未登入";
  if (dom.walletRole) dom.walletRole.textContent = "訪客";
  if (dom.networkNotice) dom.networkNotice.style.display = "none";
  if (dom.entryFooterRole) dom.entryFooterRole.textContent = "Role · Guest";
  setStatus("等待錢包連接", false);
}

async function applyConnectedState() {
  const roleLabel = getRoleLabel(state.session);
  const expectedChain = String(window.APP_CONFIG?.EXPECTED_CHAIN_ID || "0xaa36a7").toLowerCase();
  const isExpected = String(state.chainId || "").toLowerCase() === expectedChain;

  if (dom.notConnectedState) dom.notConnectedState.style.display = "none";
  if (dom.connectedState) dom.connectedState.style.display = "grid";
  if (dom.walletAddr) dom.walletAddr.textContent = state.account ? core.formatAddress(state.account) : "—";
  if (dom.walletNetwork) dom.walletNetwork.textContent = state.chainId || "-";
  if (dom.walletSessionState) dom.walletSessionState.textContent = state.session?.authenticated ? "已完成登入" : "僅完成錢包連線";
  if (dom.walletRole) dom.walletRole.textContent = roleLabel;
  if (dom.chainBadge) dom.chainBadge.textContent = state.chainId || "-";
  if (dom.networkNotice) dom.networkNotice.style.display = isExpected ? "none" : "block";
  if (dom.entryFooterRole) dom.entryFooterRole.textContent = `Role · ${roleLabel}`;
  setStatus(`錢包已連接 · ${roleLabel}`, true);

  await refreshEscrowStatus();
  await refreshBlockNumber();
}

async function hydrate(force = false) {
  try {
    const [wallet, session] = await Promise.all([
      core.getWalletState(force),
      core.getSession(force).catch(() => ({}))
    ]);

    state.account = wallet?.account || null;
    state.chainId = wallet?.chainId || null;
    state.session = session || {};

    if (!state.account) {
      applyDisconnectedState();
      await refreshBlockNumber();
      return;
    }

    await applyConnectedState();
  } catch (error) {
    applyDisconnectedState();
    showToast(normalizeError(error));
  }
}

async function handleConnect() {
  try {
    if (dom.connectButton) dom.connectButton.disabled = true;
    if (dom.connectButtonConnected) dom.connectButtonConnected.disabled = true;
    await core.connectWallet();
    await hydrate(true);
    showToast(state.session?.authenticated ? "錢包與登入已完成" : "錢包已連接");
  } catch (error) {
    showToast(normalizeError(error));
  } finally {
    if (dom.connectButton) dom.connectButton.disabled = false;
    if (dom.connectButtonConnected) dom.connectButtonConnected.disabled = false;
  }
}

async function handleSwitchNetwork() {
  try {
    if (dom.switchNetworkButton) dom.switchNetworkButton.disabled = true;
    if (dom.switchNetworkButtonConnected) dom.switchNetworkButtonConnected.disabled = true;
    await core.switchToExpectedNetwork();
    await hydrate(true);
    showToast("已切換到 Sepolia");
  } catch (error) {
    showToast(normalizeError(error));
  } finally {
    if (dom.switchNetworkButton) dom.switchNetworkButton.disabled = false;
    if (dom.switchNetworkButtonConnected) dom.switchNetworkButtonConnected.disabled = false;
  }
}

core.on(dom.connectButton, "click", handleConnect);
core.on(dom.connectButtonConnected, "click", handleConnect);
core.on(dom.switchNetworkButton, "click", handleSwitchNetwork);
core.on(dom.switchNetworkButtonConnected, "click", handleSwitchNetwork);

if (window.ethereum) {
  window.ethereum.on("accountsChanged", () => hydrate(true));
  window.ethereum.on("chainChanged", () => hydrate(true));
}

window.setInterval(tickClock, 1000);
tickClock();
hydrate(true);
