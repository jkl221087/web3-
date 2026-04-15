(function () {
  const CONTRACT_ABI = [
    "function owner() external view returns (address)",
    "function Order_ID() external view returns (uint256)",
    "function payment_token() external view returns (address)",
    "function create_and_fund_order(address seller, uint256 _amount) external returns (uint256)",
    "function confirm_order_received(uint256 orderId) external returns (bool)",
    "function withdraw_order_funds(uint256 orderId) external returns (bool)",
    "function get_order_info(uint256 orderId) external view returns ((uint256 orderId, address buy_user, address sell_user, uint256 amount, bool pay_state, bool complete_state, bool seller_withdrawn))",
    "function get_contract_balance() external view returns (uint256)"
  ];
  const PAYMENT_TOKEN_ABI = [
    "function symbol() external view returns (string)",
    "function decimals() external view returns (uint8)",
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function approve(address spender, uint256 amount) external returns (bool)"
  ];
  const CATEGORY_OPTIONS = [
    { id: "all", label: "全部商品" },
    { id: "mens", label: "男裝" },
    { id: "womens", label: "女裝" },
    { id: "kids", label: "孩童" },
    { id: "summer", label: "夏季" },
    { id: "autumn", label: "秋季" },
    { id: "winter", label: "冬季" }
  ];
  const ORDER_STAGE_META = {
    0: { label: "未建立", tone: "muted", description: "訂單尚未建立。" },
    1: { label: "已付款", tone: "info", description: "買家已付款，款項由合約託管。" },
    2: { label: "已出貨", tone: "info", description: "賣家已出貨，等待物流到站。" },
    3: { label: "已到貨", tone: "info", description: "物流已到站，可進入提醒取貨。" },
    4: { label: "等待取貨", tone: "warn", description: "賣家已提醒取貨，等待買家確認。" },
    5: { label: "已取貨", tone: "success", description: "買家已確認收貨，賣家可提領。" },
    6: { label: "已完成", tone: "success", description: "賣家已提領，訂單完成。" }
  };
  const STYLE_OPTIONS = ["上衣", "外套", "洋裝", "褲裝", "針織", "配件"];
  const SEASON_OPTIONS = ["四季", "夏季", "秋季", "冬季"];
  const DEPARTMENT_OPTIONS = ["男裝", "女裝", "孩童"];
  const CONTRACT_KEY = "fashion-store-contract-address";
  const CART_KEY = "fashion-store-cart";
  const FAVORITES_KEY = "fashion-store-favorites";
  const RECENTLY_VIEWED_KEY = "fashion-store-recently-viewed";
  const TTL = 5000;
  const runtime = { provider: null, signer: null, contract: null, paymentTokenContract: null, paymentTokenMeta: null, paymentTokenAddress: null, currentAccount: null, chainId: null, session: null };
  const cache = new Map();
  const inFlight = new Map();

  function ck(name){return name;}
  function now(){return Date.now();}
  function getCached(k){ const item=cache.get(k); if(!item) return null; if(now()-item.t>TTL){ cache.delete(k); return null;} return item.v; }
  function setCached(k,v){ cache.set(k,{t:now(),v}); return v; }
  function dedupe(k,fn){ if(inFlight.has(k)) return inFlight.get(k); const p=Promise.resolve().then(fn).finally(()=>inFlight.delete(k)); inFlight.set(k,p); return p; }
  function clearDataCache(){ cache.clear(); }
  function setText(el,v){ if(el) el.textContent = v ?? ""; }
  function setHtml(el,v){ if(el) el.innerHTML = v ?? ""; }
  function toggleHidden(el,h){ if(el) el.classList.toggle("hidden", !!h); }
  function on(el,evt,fn){ if(el) el.addEventListener(evt,fn); }
  function parseJson(key,fallback){ try{ const v=localStorage.getItem(key); return v?JSON.parse(v):fallback; }catch{return fallback;} }
  function writeJson(key,val){ localStorage.setItem(key, JSON.stringify(val)); }
  function formatAddress(address){ if(!address) return "-"; const s=String(address); return s.length<12?s:`${s.slice(0,6)}...${s.slice(-4)}`; }
  function safeBigInt(value){ try{return BigInt(value ?? 0);}catch{return 0n;} }
  function fallbackToken(){ return { symbol: String(window.APP_CONFIG?.PAYMENT_TOKEN_SYMBOL || "USDT").trim() || "USDT", decimals: Number(window.APP_CONFIG?.PAYMENT_TOKEN_DECIMALS || 6) }; }
  function formatEth(value){ const meta=runtime.paymentTokenMeta || fallbackToken(); return `${Number(window.ethers.formatUnits(value, meta.decimals)).toFixed(Math.min(4,meta.decimals))} ${meta.symbol}`; }
  function parsePaymentAmount(value){
    const meta = runtime.paymentTokenMeta || fallbackToken();
    const normalized = String(value ?? "").trim().replace(/,/g, "");
    if(!normalized) return 0n;
    return window.ethers.parseUnits(normalized, meta.decimals);
  }
  function normalizeMeta(meta){
    const toList=(v,f)=>Array.isArray(v)?(v.map(x=>String(x).trim()).filter(Boolean)):(typeof v==="string"?v.split(",").map(x=>x.trim()).filter(Boolean):f);
    const stock=Number(meta?.stock);
    return {
      mainCategory:"服裝",
      department: DEPARTMENT_OPTIONS.includes(meta?.department)?meta.department:"女裝",
      season: SEASON_OPTIONS.includes(meta?.season)?meta.season:"四季",
      style: STYLE_OPTIONS.includes(meta?.style)?meta.style:"上衣",
      imageUrl: String(meta?.imageUrl || "").trim(),
      description: String(meta?.description || "").trim(),
      sizes: [...new Set(toList(meta?.sizes, ["S","M","L"]))],
      colors: [...new Set(toList(meta?.colors, ["奶油白"]))],
      stock: Number.isFinite(stock) && stock>=0 ? Math.floor(stock) : 1
    };
  }
  function buildPlaceholderImage(product){
    if(product?.meta?.imageUrl) return product.meta.imageUrl;
    const label = encodeURIComponent(product?.name || "商品");
    return `data:image/svg+xml;charset=UTF-8,<svg xmlns="http://www.w3.org/2000/svg" width="800" height="560"><defs><linearGradient id="g" x1="0" x2="1"><stop stop-color="%235578a8"/><stop offset="1" stop-color="%236e8fb8"/></linearGradient></defs><rect width="100%" height="100%" fill="url(%23g)"/><text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" fill="white" font-size="42" font-family="sans-serif">${label}</text></svg>`;
  }
  async function apiRequest(path, options={}){
    const headers = new Headers(options.headers || {});
    const authActor = options.authActor === false ? "" : (runtime.currentAccount || "");
    if(authActor) headers.set("x-actor-address", authActor);
    if(!(options.body instanceof FormData) && !headers.has("Content-Type")) headers.set("Content-Type","application/json");
    const res = await fetch(path,{...options, credentials:"same-origin", headers});
    const payload = await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(payload.error || payload.message || "API request failed");
    return payload;
  }

  async function fetchSessionProfile() {
    const payload = await apiRequest("/api/me", { method: "GET", authActor: false }).catch(() => ({}));
    runtime.session = payload || {};
    return runtime.session;
  }

  async function signInWithBackend() {
    if (!runtime.currentAccount) {
      throw new Error("請先連接錢包");
    }

    const chainId = runtime.chainId || await window.ethereum.request({ method: "eth_chainId" });
    const noncePayload = await apiRequest("/api/auth/nonce", {
      method: "POST",
      authActor: false,
      body: JSON.stringify({
        address: runtime.currentAccount,
        chainId
      })
    });

    const message = String(noncePayload?.message || "");
    if (!message) {
      throw new Error("無法取得登入訊息");
    }

    if (!runtime.signer) {
      await ensureSigner();
    }

    const signature = await runtime.signer.signMessage(message);
    const session = await apiRequest("/api/auth/verify", {
      method: "POST",
      authActor: false,
      body: JSON.stringify({
        address: runtime.currentAccount,
        message,
        signature
      })
    });

    runtime.session = session || {};
    return runtime.session;
  }

  async function logoutBackendSession() {
    await apiRequest("/api/auth/logout", {
      method: "POST",
      authActor: false,
      body: JSON.stringify({})
    }).catch(() => ({}));
    runtime.session = null;
  }
  function getConfiguredContractAddress(){
    const configured=String(window.APP_CONFIG?.DEFAULT_CONTRACT_ADDRESS || "").trim();
    const stored=String(localStorage.getItem(CONTRACT_KEY) || "").trim();
    if(window.ethers?.isAddress(configured)) return configured;
    if(window.ethers?.isAddress(stored)) return stored;
    return "";
  }
  async function ensureProvider(){ if(!window.ethereum) throw new Error("找不到錢包提供者"); if(!runtime.provider) runtime.provider=new window.ethers.BrowserProvider(window.ethereum); return runtime.provider; }
  async function ensureSigner(){ const provider=await ensureProvider(); if(!runtime.signer) runtime.signer = await provider.getSigner(); return runtime.signer; }
  async function ensureContract(options={}){
    const requireSigner=!!options.requireSigner; const runner=requireSigner?await ensureSigner():await ensureProvider(); const address=getConfiguredContractAddress(); if(!address) throw new Error("尚未設定合約地址");
    if(!runtime.contract || runtime.contract.target?.toLowerCase() !== address.toLowerCase()) runtime.contract = new window.ethers.Contract(address, CONTRACT_ABI, runner);
    else if(requireSigner && runtime.contract.runner !== runtime.signer) runtime.contract = runtime.contract.connect(runtime.signer);
    return runtime.contract;
  }
  async function ensurePaymentToken(options={}){
    const requireSigner=!!options.requireSigner; const contract=await ensureContract({requireSigner}); const runner=requireSigner?await ensureSigner():await ensureProvider(); const addr=await contract.payment_token();
    if(!runtime.paymentTokenContract || runtime.paymentTokenAddress?.toLowerCase() !== addr.toLowerCase()){ runtime.paymentTokenContract = new window.ethers.Contract(addr, PAYMENT_TOKEN_ABI, runner); runtime.paymentTokenAddress=addr; runtime.paymentTokenMeta=null; }
    else if(requireSigner && runtime.paymentTokenContract.runner !== runtime.signer){ runtime.paymentTokenContract = runtime.paymentTokenContract.connect(runtime.signer); }
    if(!runtime.paymentTokenMeta){
      const fallback=fallbackToken();
      const [s,d] = await Promise.allSettled([runtime.paymentTokenContract.symbol(), runtime.paymentTokenContract.decimals()]);
      runtime.paymentTokenMeta = { symbol: s.status==="fulfilled"?s.value:fallback.symbol, decimals: d.status==="fulfilled"?Number(d.value):fallback.decimals };
    }
    return runtime.paymentTokenContract;
  }
  async function ensurePaymentTokenApproval(requiredAmount){
    const amount=safeBigInt(requiredAmount); if(amount<=0n) return;
    const contract=await ensureContract({requireSigner:true}); const token=await ensurePaymentToken({requireSigner:true}); const owner=runtime.currentAccount || await (await ensureSigner()).getAddress();
    const allowance=await token.allowance(owner, contract.target); if(allowance>=amount) return; const tx=await token.approve(contract.target, amount); await tx.wait();
  }
  async function getWalletState(force=false){
    if(force){ runtime.currentAccount=null; runtime.chainId=null; }
    if(!window.ethereum) return {account:null, chainId:null};
    const provider=await ensureProvider(); const network=await provider.getNetwork(); const accounts=await provider.send("eth_accounts",[]);
    runtime.chainId=`0x${Number(network.chainId).toString(16)}`; runtime.currentAccount=accounts?.[0]||null;
    try{ await ensurePaymentToken(); }catch{}
    return {account:runtime.currentAccount, chainId:runtime.chainId};
  }
  async function connectWallet(){
    const provider=await ensureProvider();
    const accounts=await provider.send("eth_requestAccounts",[]);
    runtime.currentAccount=accounts?.[0]||null;
    runtime.signer=await provider.getSigner();

    const network=await provider.getNetwork();
    runtime.chainId=`0x${Number(network.chainId).toString(16)}`;

    try{
      await signInWithBackend();
    }catch(error){
      console.warn("backend sign-in failed during wallet connect:", error);
      runtime.session = null;
    }

    try{
      await ensurePaymentToken();
    }catch(error){
      console.warn("payment token init skipped during wallet connect:", error);
    }

    clearDataCache();
    return {account:runtime.currentAccount, chainId:runtime.chainId, session:runtime.session};
  }
  async function switchToExpectedNetwork(){
    const expected=String(window.APP_CONFIG?.EXPECTED_CHAIN_ID || "").trim(); if(!window.ethereum || !expected) return;
    await window.ethereum.request({method:"wallet_switchEthereumChain", params:[{chainId:expected}]});
    return getWalletState(true);
  }
  async function getSession(force=false){
    const key=ck("session");
    if(!force){
      const hit=getCached(key);
      if(hit){
        runtime.session = hit;
        return hit;
      }
    }
    const result = await dedupe(key, async()=> {
      const payload = await fetchSessionProfile().catch(()=>({}));
      return payload || {};
    });
    runtime.session=result;
    return setCached(key,result);
  }
  async function fetchOrderRecords(force=false){
    const key=ck("orderRecords"); if(!force){ const hit=getCached(key); if(hit) return hit; }
    const result=await dedupe(key, async()=>{ const payload=await apiRequest("/api/orders",{method:"GET"}); return (payload && typeof payload==="object") ? payload : {}; });
    return setCached(key,result);
  }
  function serializeOrder(order){
    const stage = order.seller_withdrawn ? 6 : order.complete_state ? 5 : Math.max(1, Math.min(4, Number(order.flowStage || 1)));
    const stageMeta = ORDER_STAGE_META[stage] || ORDER_STAGE_META[1];
    return {
      orderId:Number(order.orderId || 0),
      productId:Number(order.productId || 0),
      productName: order.productName || "",
      buyer: order.buy_user || "",
      seller: order.sell_user || "",
      amountWei: safeBigInt(order.amount || 0),
      payState:Boolean(order.pay_state),
      completeState:Boolean(order.complete_state),
      sellerWithdrawn:Boolean(order.seller_withdrawn),
      stage, stageLabel: stageMeta.label, stageDescription: stageMeta.description, stageTone: stageMeta.tone
    };
  }
  async function getOrders(force=false){
    const key=ck("orders"); if(!force){ const hit=getCached(key); if(hit) return hit; }
    const result=await dedupe(key, async()=>{
      const contract=await ensureContract(); const total=Number(await contract.Order_ID()); if(!total) return [];
      const records=await fetchOrderRecords(force);
      const settled=await Promise.allSettled(Array.from({length:total},(_,i)=>contract.get_order_info(i+1)));
      return settled.filter(x=>x.status==="fulfilled").map(x=>{
        const order=x.value; const record=records[String(Number(order.orderId))] || {};
        return serializeOrder({ orderId: order.orderId, buy_user: order.buy_user, sell_user: order.sell_user, amount: order.amount, pay_state: order.pay_state, complete_state: order.complete_state, seller_withdrawn: order.seller_withdrawn, productId: record.productId || 0, productName: record.productName || "", flowStage: record.flowStage || 1 });
      }).sort((a,b)=>b.orderId-a.orderId);
    });
    return setCached(key,result);
  }
  async function getProducts(force=false){
    const key=ck("products"); if(!force){ const hit=getCached(key); if(hit) return hit; }
    const result=await dedupe(key, async()=>{
      const rows=await apiRequest("/api/products",{method:"GET"}); return (Array.isArray(rows)?rows:[]).map(record=>{
        const priceWei=safeBigInt(record.priceWei);
        const product={ productId:Number(record.productId), seller:record.seller, name:record.name, priceWei, priceDisplay:formatEth(priceWei), isActive:Boolean(record.isActive), meta:normalizeMeta(record.meta) };
        product.image=buildPlaceholderImage(product); return product;
      }).sort((a,b)=>b.productId-a.productId);
    });
    return setCached(key,result);
  }
  async function getReviews(force=false){
    const key=ck("reviews"); if(!force){ const hit=getCached(key); if(hit) return hit; }
    const result=await dedupe(key, async()=>{ const rows=await apiRequest("/api/reviews",{method:"GET"}); return Array.isArray(rows)?rows:[]; });
    return setCached(key,result);
  }
  async function getPayouts(force=false){
    const key=ck("payouts"); if(!force){ const hit=getCached(key); if(hit) return hit; }
    const result=await dedupe(key, async()=>{ const rows=await apiRequest("/api/payouts",{method:"GET"}); return Array.isArray(rows)?rows:[]; });
    return setCached(key,result);
  }
  async function getSellersStore(force=false){
    const key=ck("sellers"); if(!force){ const hit=getCached(key); if(hit) return hit; }
    const result=await dedupe(key, async()=>{ const store=await apiRequest("/api/sellers",{method:"GET"}); return {approved:Array.isArray(store.approved)?store.approved:[], pending:Array.isArray(store.pending)?store.pending:[]}; });
    return setCached(key,result);
  }
  async function getSellerProfile(address, force=false){
    const wallet=String(address || runtime.currentAccount || "").toLowerCase();
    const [store,session,owner] = await Promise.all([
      getSellersStore(force),
      getSession(force),
      dedupe(ck("owner"), async()=>{ try{ const contract=await ensureContract(); return String(await contract.owner()).toLowerCase(); }catch{return "";} })
    ]);
    return { approved: store.approved.map(String).map(x=>x.toLowerCase()).includes(wallet) || wallet===owner, pending: store.pending.map(String).map(x=>x.toLowerCase()).includes(wallet), isContractOwner: wallet===owner, authenticated: !!session?.authenticated };
  }
  async function getAdminDashboard(force=false){ const key=ck("adminDashboard"); if(!force){ const hit=getCached(key); if(hit) return hit; } const result=await dedupe(key, ()=>apiRequest("/api/dashboard/admin",{method:"GET"})); return setCached(key,result); }
  async function getBuyerDashboard(force=false){ const key=ck("buyerDashboard"); if(!force){ const hit=getCached(key); if(hit) return hit; } const result=await dedupe(key, ()=>apiRequest("/api/dashboard/buyer",{method:"GET"})); return setCached(key,result); }
  async function getSellerDashboard(force=false){ const key=ck("sellerDashboard"); if(!force){ const hit=getCached(key); if(hit) return hit; } const result=await dedupe(key, ()=>apiRequest("/api/dashboard/seller",{method:"GET"})); return setCached(key,result); }
  async function getStoreSnapshot(force=false){ const [wallet,session,products,orders,reviews,payouts]=await Promise.all([getWalletState(force),getSession(force),getProducts(force),getOrders(force),getReviews(force),getPayouts(force)]); return {wallet,session,products,orders,reviews,payouts}; }
  async function requestSellerAccess(address){ await apiRequest("/api/sellers/request",{method:"POST", body: JSON.stringify({address})}); clearDataCache(); }
  async function approveSellerAccess(address,approved=true){ await apiRequest("/api/sellers/approve",{method:"POST", body: JSON.stringify({address, approved})}); clearDataCache(); }
  async function uploadProductImage(file){ const fd=new FormData(); fd.append("image", file); return apiRequest("/api/uploads/product-image",{method:"POST", body:fd}); }
  async function createProduct(input){ const result=await apiRequest("/api/products",{method:"POST", body: JSON.stringify({ seller: input.seller || runtime.currentAccount || "", name: String(input.name || "").trim(), priceWei: String(input.priceWei?.toString?.() || input.priceWei || "0"), meta: normalizeMeta(input.meta) })}); clearDataCache(); return result; }
  async function updateProduct(productId,input){ const payload={}; if("name" in input) payload.name=String(input.name || "").trim(); if("priceWei" in input) payload.priceWei=String(input.priceWei?.toString?.() || input.priceWei || "0"); if("meta" in input) payload.meta=normalizeMeta(input.meta); if("isActive" in input) payload.isActive=!!input.isActive; const result=await apiRequest(`/api/products/${productId}`,{method:"PATCH", body:JSON.stringify(payload)}); clearDataCache(); return result; }
  async function setProductActive(productId, isActive){ return updateProduct(productId,{isActive}); }
  async function saveOrderMeta(orderId,meta){ const result=await apiRequest("/api/orders",{method:"POST", body: JSON.stringify({orderId:Number(orderId)||0, buyer: meta.buyer || runtime.currentAccount || "", productId:Number(meta.productId)||0, productName: meta.productName || "", productSeller: meta.productSeller || "", priceWei: String(meta.priceWei?.toString?.() || meta.priceWei || "0"), flowStage: Number(meta.flowStage || 1)})}); clearDataCache(); return result; }
  async function saveOrderFlowStage(orderId,stage){ const result=await apiRequest(`/api/orders/${orderId}/flow`,{method:"PATCH", body: JSON.stringify({flowStage: Math.max(1, Math.min(4, Number(stage)||1))})}); clearDataCache(); return result; }
  async function saveReview(input){ const result=await apiRequest("/api/reviews",{method:"POST", body: JSON.stringify({orderId:Number(input.orderId)||0, productId:Number(input.productId)||0, productName:input.productName||"", seller:input.seller||"", buyer:input.buyer||"", rating:Number(input.rating)||0, comment:input.comment||"", createdAt: input.createdAt || new Date().toISOString()})}); clearDataCache(); return result; }
  async function savePayout(input){ const result=await apiRequest("/api/payouts",{method:"POST", body: JSON.stringify({orderId:Number(input.orderId)||0, seller:input.seller||"", buyer:input.buyer||"", productId:Number(input.productId)||0, productName:input.productName||"", amountWei:String(input.amountWei?.toString?.() || input.amountWei || "0"), txHash:input.txHash||"", createdAt: input.createdAt || new Date().toISOString()})}); clearDataCache(); return result; }
  function getOrderStageMeta(stage){ return ORDER_STAGE_META[Number(stage)||0] || ORDER_STAGE_META[0]; }
  function isOrderRestricted(order){ const risk=String(order?.riskStatus || order?.risk_status || "").toLowerCase(); const screening=String(order?.screeningStatus || order?.screening_status || "").toLowerCase(); return !!(order?.frozen || order?.payoutBlocked || risk==="blocked" || risk==="review" || screening==="sanction_hit"); }
  function getOrderRestrictionReason(order){ if(order?.frozen) return "訂單目前已凍結，需等待平台處理。"; if(order?.payoutBlocked) return "此訂單提領已被暫停。"; const risk=String(order?.riskStatus || order?.risk_status || "").toLowerCase(); if(risk==="blocked") return "訂單已被風控阻擋。"; if(risk==="review") return "訂單正在人工審查。"; return "訂單目前受限制。"; }
  function getCart(){ const cart=parseJson(CART_KEY,[]); return Array.isArray(cart)?cart:[]; }
  function saveCart(cart){ writeJson(CART_KEY, cart || []); }
  function getFavoriteProductIds(){ const items=parseJson(FAVORITES_KEY,[]); return Array.isArray(items)?items.map(Number).filter(Boolean):[]; }
  function isFavoriteProduct(productId){ return getFavoriteProductIds().includes(Number(productId)); }
  function toggleFavoriteProduct(productId){ const target=Number(productId); const now=getFavoriteProductIds(); const next=now.includes(target)?now.filter(x=>x!==target):[target,...now].slice(0,24); writeJson(FAVORITES_KEY,next); return next; }
  function getRecentlyViewedProductIds(){ const items=parseJson(RECENTLY_VIEWED_KEY,[]); return Array.isArray(items)?items.map(Number).filter(Boolean):[]; }
  function pushRecentlyViewedProduct(productId){ const target=Number(productId); const current=getRecentlyViewedProductIds().filter(x=>x!==target); const next=[target,...current].slice(0,18); writeJson(RECENTLY_VIEWED_KEY,next); return next; }


  function createPageToast(toastStack){
    return function toast(type, message){
      if(!toastStack) return;
      const node=document.createElement("article");
      node.className=`toast ${type}`;
      node.textContent=message;
      toastStack.prepend(node);
      window.setTimeout(()=>node.remove(), 3200);
    };
  }
  function normalizeAppError(error){
    return String(error?.reason || error?.shortMessage || error?.message || "發生未知錯誤").replace(/^execution reverted:\s*/, "");
  }
  function applyWalletHeader(dom, state, extra){
    setText(dom?.walletAddress, state?.account ? formatAddress(state.account) : "尚未連接");
    setText(dom?.chainId, state?.chainId || "-");
    const contractAddress = getConfiguredContractAddress();
    setText(dom?.contractAddressLabel, contractAddress ? formatAddress(contractAddress) : "未設定");
    if(typeof extra === "function"){
      extra({ dom, state, core: window.FashionStoreCore });
    }
  }
  async function syncWalletSession(state, force=false){
    const [wallet, session] = await Promise.all([
      getWalletState(force),
      getSession(force).catch(()=>({}))
    ]);
    if(state){
      state.account = wallet.account || null;
      if(Object.prototype.hasOwnProperty.call(state, "chainId")) state.chainId = wallet.chainId || null;
      state.session = session || {};
    }
    return { wallet, session };
  }
  function createPageBootstrap(options={}){
    const dom = options.dom || {};
    const state = options.state || {};
    const setHeader = options.setHeader;
    const hydrate = options.hydrate;
    const toast = createPageToast(options.toastStack || dom.toastStack);
    const normalizeError = normalizeAppError;
    async function sync(force=false){
      const result = await syncWalletSession(state, force);
      if(typeof setHeader === "function") setHeader();
      return result;
    }
    async function connect(){
      const button = options.connectButton || dom.connectButton;
      if(button) button.disabled = true;
      try{
        const result = await connectWallet();
        state.account = result.account || null;
        if(Object.prototype.hasOwnProperty.call(state, "chainId")) state.chainId = result.chainId || null;
        state.session = result.session || await getSession(true).catch(()=>({}));
        if(typeof setHeader === "function") setHeader();
        if(typeof hydrate === "function") await hydrate(true);
        toast("success", options.connectedMessage || "錢包已連接");
        return result;
      }catch(error){
        toast("error", normalizeError(error));
        throw error;
      }finally{
        if(button) button.disabled = false;
      }
    }
    async function switchNetwork(){
      const button = options.switchNetworkButton || dom.switchNetworkButton;
      if(button) button.disabled = true;
      try{
        await switchToExpectedNetwork();
        await sync(true);
        if(typeof hydrate === "function") await hydrate(true);
        toast("success", options.switchedMessage || "已切換到 Sepolia");
      }catch(error){
        toast("error", normalizeError(error));
        throw error;
      }finally{
        if(button) button.disabled = false;
      }
    }
    function bind(){
      on(options.connectButton || dom.connectButton, "click", connect);
      on(options.switchNetworkButton || dom.switchNetworkButton, "click", switchNetwork);
      if(options.domReady !== false){
        document.addEventListener("DOMContentLoaded", ()=>{
          if(typeof options.beforeHydrate === "function") options.beforeHydrate();
          if(typeof hydrate === "function") hydrate();
        });
      }
    }
    return { toast, normalizeError, sync, connect, switchNetwork, bind, setHeader: ()=>{ if(typeof setHeader === "function") setHeader(); } };
  }

  window.FashionStoreCore = {
    runtime, CATEGORY_OPTIONS, ORDER_STAGE_META,
    setText, setHtml, toggleHidden, on, parseJson, writeJson, clearDataCache,
    createPageToast, normalizeAppError, applyWalletHeader, syncWalletSession, createPageBootstrap,
    apiRequest, fetchSessionProfile, signInWithBackend, logoutBackendSession,
    getConfiguredContractAddress, getWalletState, connectWallet, switchToExpectedNetwork, getSession,
    ensureContract, ensurePaymentToken, ensurePaymentTokenApproval,
    getProducts, getOrders, getReviews, getPayouts, getStoreSnapshot,
    getAdminDashboard, getBuyerDashboard, getSellerDashboard, getSellersStore, getSellerProfile,
    requestSellerAccess, approveSellerAccess, uploadProductImage,
    createProduct, updateProduct, setProductActive, saveOrderMeta, saveOrderFlowStage, saveReview, savePayout,
    parsePaymentAmount, formatAddress, formatEth, normalizeMeta, buildPlaceholderImage, safeBigInt,
    getOrderStageMeta, isOrderRestricted, getOrderRestrictionReason,
    getCart, saveCart, getFavoriteProductIds, isFavoriteProduct, toggleFavoriteProduct, getRecentlyViewedProductIds, pushRecentlyViewedProduct
  };
})();
