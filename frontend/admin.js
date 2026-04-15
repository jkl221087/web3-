const core = window.FashionStoreCore;
const dom = {
  connectButton: document.getElementById("connectButton"),
  switchNetworkButton: document.getElementById("switchNetworkButton"),
  walletAddress: document.getElementById("walletAddress"),
  chainId: document.getElementById("chainId"),
  contractAddressLabel: document.getElementById("contractAddressLabel"),
  adminStatusLabel: document.getElementById("adminStatusLabel"),
  adminGateCard: document.getElementById("adminGateCard"),
  adminWorkspace: document.getElementById("adminWorkspace"),
  adminMetrics: document.getElementById("adminMetrics"),
  sellerRequestList: document.getElementById("sellerRequestList"),
  productModerationGrid: document.getElementById("productModerationGrid"),
  adminAuditLog: document.getElementById("adminAuditLog"),
  adminOrderMonitor: document.getElementById("adminOrderMonitor"),
  adminPayoutMonitor: document.getElementById("adminPayoutMonitor"),
  refreshButton: document.getElementById("refreshButton"),
  toastStack: document.getElementById("toastStack")
};
const state = { account:null, chainId:null, session:null, dashboard:null, sellerProfile:null };
const bootstrap = core.createPageBootstrap({ dom, state, setHeader, hydrate });
const toast = bootstrap.toast;
const normalizeError = bootstrap.normalizeError;
function setHeader(){
  core.applyWalletHeader(dom, state, ({ dom, state }) => {
    core.setText(dom.adminStatusLabel, state.sellerProfile?.isContractOwner ? "管理員" : (state.session?.authenticated ? "非管理員" : "未登入"));
  });
}
function render(){
  const isAdmin = !!state.sellerProfile?.isContractOwner;
  if(!state.account){ core.setHtml(dom.adminGateCard, '<article class="member-focus-card"><span>權限</span><h3>請先連接錢包</h3><p>連接後系統才會檢查你是否具備管理權限。</p></article>'); core.toggleHidden(dom.adminWorkspace, true); return; }
  if(!state.session?.authenticated){ core.setHtml(dom.adminGateCard, '<article class="member-focus-card"><span>權限</span><h3>請先完成錢包登入</h3><p>管理控制台目前使用後端工作階段驗證身份。</p></article>'); core.toggleHidden(dom.adminWorkspace, true); return; }
  if(!isAdmin){ core.setHtml(dom.adminGateCard, '<article class="member-focus-card"><span>權限</span><h3>目前地址不是管理員</h3><p>此頁面僅提供給 owner / 管理員使用。</p></article>'); core.toggleHidden(dom.adminWorkspace, true); return; }
  core.setHtml(dom.adminGateCard, '<article class="member-focus-card"><span>權限</span><h3>管理權限已通過</h3><p>目前地址可使用平台營運、審核與監控功能。</p></article>'); core.toggleHidden(dom.adminWorkspace, false);
  const dashboard = state.dashboard || {};
  const products = Array.isArray(dashboard.products) ? dashboard.products : [];
  const orders = Array.isArray(dashboard.orders)
    ? dashboard.orders
    : Object.values(dashboard.orders || {});
  const payouts = Array.isArray(dashboard.payouts) ? dashboard.payouts : [];
  const reviews = Array.isArray(dashboard.reviews) ? dashboard.reviews : [];
  const pending = Array.isArray(dashboard.sellers?.pending) ? dashboard.sellers.pending : [];
  core.setHtml(dom.adminMetrics, `
    <article class="metric-card"><span>待審核賣家</span><strong>${pending.length}</strong><p>待 owner 核准的賣家申請數。</p></article>
    <article class="metric-card"><span>商品總數</span><strong>${products.length}</strong><p>全店 mock database 商品數。</p></article>
    <article class="metric-card"><span>訂單總數</span><strong>${orders.length}</strong><p>鏈上託管訂單與鏈下流程合併結果。</p></article>
    <article class="metric-card"><span>提領紀錄</span><strong>${payouts.length}</strong><p>已寫入後端帳務歷史的提領筆數。</p></article>`);
  core.setHtml(dom.sellerRequestList, pending.length ? pending.map(address=>`<article class="request-card"><strong>${core.formatAddress(address)}</strong><p>待核准賣家申請</p><div class="detail-actions"><button class="button primary" data-approve="${address}">核准</button><button class="button ghost" data-reject="${address}">退回</button></div></article>`).join("") : '<article class="request-card empty"><strong>目前沒有待審核賣家</strong><p>新的申請送出後，這裡會立即顯示。</p></article>');
  core.setHtml(dom.productModerationGrid, products.length ? products.map(p=>`<article class="inventory-card inventory-card-wide"><img src="${p.image || core.buildPlaceholderImage(p)}" alt="${p.name}"><div class="inventory-meta"><div><h3>${p.name}</h3><p>商品 #${p.productId} ・ ${p.meta?.department || ""} ・ ${p.meta?.season || ""} ・ ${p.meta?.style || ""}</p><p>賣家：${core.formatAddress(p.seller)}</p><div class="detail-tags"><span class="tag-pill">${p.isActive?'販售中':'已下架'}</span><span class="tag-pill">${p.meta?.imageUrl?'有圖片':'缺圖片'}</span><span class="tag-pill">${p.meta?.description?'有敘述':'缺敘述'}</span></div></div><div class="price-row"><strong>${core.formatEth(p.priceWei || 0)}</strong><div class="detail-actions"><button class="button ${p.isActive?'ghost':'primary'}" data-toggle-product="${p.productId}">${p.isActive?'下架':'重新上架'}</button></div></div></div></article>`).join("") : '<article class="panel-card"><strong>目前沒有商品</strong><p>賣家建立商品後，這裡會顯示全店清單。</p></article>');
  core.setHtml(dom.adminAuditLog, (dashboard.auditLogs || []).slice(0,8).map(log=>`<article class="member-focus-card"><span>${log.category || "異動"}</span><h3>${log.summary || "系統紀錄"}</h3><p>操作者：${core.formatAddress(log.actor)}</p><p>對象：${log.subject || "-"}</p><p>${log.createdAt || ""}</p></article>`).join("") || '<article class="member-focus-card"><span>Audit</span><h3>目前沒有異動紀錄</h3><p>賣家審核、商品異動與流程更新會寫入這裡。</p></article>');
  core.setHtml(dom.adminOrderMonitor, orders.slice(0,6).map(o=>`<article class="member-focus-card"><span>訂單 #${o.orderId}</span><h3>${o.productName || `商品 #${o.productId}`}</h3><p>買家：${core.formatAddress(o.buyer)}</p><p>賣家：${core.formatAddress(o.seller)}</p><p>${o.stageLabel || ""}</p></article>`).join("") || '<article class="member-focus-card"><span>Orders</span><h3>目前沒有訂單</h3><p>訂單建立後，這裡會顯示最近動態。</p></article>');
  core.setHtml(dom.adminPayoutMonitor, payouts.slice(0,6).map(p=>`<article class="member-focus-card"><span>訂單 #${p.orderId}</span><h3>${p.productName || `商品 #${p.productId}`}</h3><p>${core.formatEth(BigInt(p.amountWei || "0"))}</p><p>${p.createdAt || ""}</p></article>`).join("") || '<article class="member-focus-card"><span>Payouts</span><h3>目前沒有提領紀錄</h3><p>完成提領後，這裡會留下帳務歷史。</p></article>');
}
async function hydrate(force=false){
  try{
    await bootstrap.sync(force);
    const [profile, dashboard] = await Promise.all([core.getSellerProfile(undefined, force), core.getAdminDashboard(force).catch(()=>({}))]);
    state.sellerProfile=profile; state.dashboard=dashboard; setHeader(); render();
  }catch(error){ toast("error", normalizeError(error)); }
}
bootstrap.bind();
core.on(dom.refreshButton,"click", ()=>hydrate(true));
core.on(dom.sellerRequestList,"click", async (event)=>{ const approve=event.target.closest("[data-approve]")?.dataset.approve; const reject=event.target.closest("[data-reject]")?.dataset.reject; try{ if(approve){ await core.approveSellerAccess(approve,true); toast("success","已核准賣家"); await hydrate(true);} if(reject){ await core.approveSellerAccess(reject,false); toast("success","已退回賣家申請"); await hydrate(true);} }catch(error){ toast("error", normalizeError(error)); }});
core.on(dom.productModerationGrid,"click", async (event)=>{ const id=event.target.closest("[data-toggle-product]")?.dataset.toggleProduct; if(!id) return; try{ const product=(state.dashboard?.products || []).find(p=>Number(p.productId)===Number(id)); if(!product) return; await core.setProductActive(product.productId, !product.isActive); toast("success", product.isActive ? "商品已下架" : "商品已重新上架"); await hydrate(true);}catch(error){ toast("error", normalizeError(error)); }});

