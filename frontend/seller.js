const core = window.FashionStoreCore;
const dom = {
  connectButton: document.getElementById("connectButton"),
  switchNetworkButton: document.getElementById("switchNetworkButton"),
  sellerStatusLabel: document.getElementById("sellerStatusLabel"),
  sellerStatusBadge: document.getElementById("sellerStatusBadge"),
  sellerGateTitle: document.getElementById("sellerGateTitle"),
  sellerGateDescription: document.getElementById("sellerGateDescription"),
  requestSellerAccessButton: document.getElementById("requestSellerAccessButton"),
  sellerAdminPanel: document.getElementById("sellerAdminPanel"),
  sellerRequestsList: document.getElementById("sellerRequestsList"),
  refreshRequestsButton: document.getElementById("refreshRequestsButton"),
  sellerWorkspace: document.getElementById("sellerWorkspace"),
  createProductForm: document.getElementById("createProductForm"),
  formEyebrow: document.getElementById("formEyebrow"),
  formTitle: document.getElementById("formTitle"),
  productName: document.getElementById("productName"),
  productPrice: document.getElementById("productPrice"),
  departmentSelect: document.getElementById("departmentSelect"),
  seasonSelect: document.getElementById("seasonSelect"),
  styleSelect: document.getElementById("styleSelect"),
  sizesInput: document.getElementById("sizesInput"),
  colorsInput: document.getElementById("colorsInput"),
  stockInput: document.getElementById("stockInput"),
  imageFileInput: document.getElementById("imageFileInput"),
  imageUrlInput: document.getElementById("imageUrlInput"),
  imageUploadStatus: document.getElementById("imageUploadStatus"),
  descriptionInput: document.getElementById("descriptionInput"),
  submitProductButton: document.getElementById("submitProductButton"),
  cancelEditButton: document.getElementById("cancelEditButton"),
  previewImage: document.getElementById("previewImage"),
  previewDepartment: document.getElementById("previewDepartment"),
  previewSeason: document.getElementById("previewSeason"),
  previewStyle: document.getElementById("previewStyle"),
  previewName: document.getElementById("previewName"),
  previewDescription: document.getElementById("previewDescription"),
  previewStock: document.getElementById("previewStock"),
  previewOptions: document.getElementById("previewOptions"),
  inventoryCount: document.getElementById("inventoryCount"),
  refreshInventoryButton: document.getElementById("refreshInventoryButton"),
  inventoryGrid: document.getElementById("inventoryGrid"),
  readinessChecklist: document.getElementById("readinessChecklist"),
  governanceStrip: document.getElementById("governanceStrip"),
  alertList: document.getElementById("alertList"),
  confirmDeleteModal: document.getElementById("confirmDeleteModal"),
  confirmDeleteBackdrop: document.getElementById("confirmDeleteBackdrop"),
  confirmDeleteTitle: document.getElementById("confirmDeleteTitle"),
  confirmDeleteMessage: document.getElementById("confirmDeleteMessage"),
  confirmDeleteCancel: document.getElementById("confirmDeleteCancel"),
  confirmDeleteAccept: document.getElementById("confirmDeleteAccept"),
  toastStack: document.getElementById("toastStack")
};


const state = {
  account: null,
  session: null,
  products: [],
  sellerProfile: { approved: false, pending: false, isContractOwner: false },
  sellerRequests: [],
  editingProductId: null
};

let deleteResolver = null;

const bootstrap = core.createPageBootstrap({
  dom,
  state,
  hydrate,
  beforeHydrate: resetForm
});

const toast = bootstrap.toast;
const normalizeError = bootstrap.normalizeError;


function uploadStatus(msg, tone = "neutral") { if (!dom.imageUploadStatus) return; dom.imageUploadStatus.textContent = msg; dom.imageUploadStatus.className = tone === "neutral" ? "upload-note" : `upload-note ${tone}`; }
function buildMeta(){ return core.normalizeMeta({ department: dom.departmentSelect?.value, season: dom.seasonSelect?.value, style: dom.styleSelect?.value, sizes: dom.sizesInput?.value, colors: dom.colorsInput?.value, stock: dom.stockInput?.value, imageUrl: dom.imageUrlInput?.value, description: dom.descriptionInput?.value }); }
function renderPreview(){
  const meta=buildMeta(); const product={name: dom.productName?.value?.trim() || "服裝商品預覽", meta};
  core.setText(dom.previewDepartment, meta.department); core.setText(dom.previewSeason, meta.season); core.setText(dom.previewStyle, meta.style);
  core.setText(dom.previewName, product.name); core.setText(dom.previewDescription, meta.description || "上架後這張卡片會像商店前台一樣顯示分類、季節與敘述。");
  core.setText(dom.previewStock, `可售庫存：${meta.stock}`); core.setText(dom.previewOptions, `尺寸：${meta.sizes.join(" / ")} ・ 顏色：${meta.colors.join(" / ")}`);
  if(dom.previewImage) dom.previewImage.src = core.buildPlaceholderImage(product);
}
function setGate(status){
  if(dom.sellerStatusBadge){ dom.sellerStatusBadge.className = `status-badge ${status.tone}`; dom.sellerStatusBadge.textContent=status.badge; }
  core.setText(dom.sellerGateTitle, status.title); core.setText(dom.sellerGateDescription, status.description); core.setText(dom.sellerStatusLabel, status.badge);
  if(dom.requestSellerAccessButton) dom.requestSellerAccessButton.disabled = !!status.disableRequest;
  core.toggleHidden(dom.sellerWorkspace, !status.showWorkspace); core.toggleHidden(dom.sellerAdminPanel, !status.showAdmin);
}
function renderAccess(){
  if(!state.account){ setGate({tone:"neutral",badge:"未連接",title:"請先連接錢包",description:"連接後會檢查地址是否通過賣家審核，只有核准地址才能進入商品管理。",disableRequest:true,showWorkspace:false,showAdmin:false}); return; }
  if(!state.session?.authenticated){ setGate({tone:"neutral",badge:"未登入",title:"請先完成錢包登入",description:"請重新連接錢包並完成簽名登入後，再進行賣家資格判斷。",disableRequest:true,showWorkspace:false,showAdmin:false}); return; }
  if(state.sellerProfile.approved){ setGate({tone:"success",badge: state.sellerProfile.isContractOwner ? "Owner / 賣家" : "已核准賣家",title:"賣家資格已通過",description:"目前地址已具備賣家權限，可以進行商品上架與庫存管理。",disableRequest:true,showWorkspace:true,showAdmin:state.sellerProfile.isContractOwner}); return; }
  if(state.sellerProfile.pending){ setGate({tone:"warn",badge:"審核中",title:"賣家申請已送出",description:"目前地址正在等待 owner 審核，通過後才會開放賣家後台功能。",disableRequest:true,showWorkspace:false,showAdmin:false}); return; }
  setGate({tone:"neutral",badge:"買家模式",title:"目前地址尚未成為賣家",description:"請先送出申請，核准後才能進入商品管理。",disableRequest:false,showWorkspace:false,showAdmin:false});
}
function renderRequests(){
  if(!dom.sellerRequestsList) return;
  if(!state.sellerProfile.isContractOwner){ dom.sellerRequestsList.innerHTML=""; return; }
  dom.sellerRequestsList.innerHTML = state.sellerRequests.length ? state.sellerRequests.map(address=>`<article class="request-card"><div><strong>${core.formatAddress(address)}</strong><p>待審核賣家申請</p></div><div class="detail-actions"><button class="button primary" data-approve="${address}">核准</button><button class="button ghost" data-reject="${address}">退回</button></div></article>`).join("") : '<article class="request-card empty"><strong>目前沒有待審核賣家</strong><p>新的申請送出後，這裡會立即顯示。</p></article>';
}
function resetForm(){
  state.editingProductId=null;
  dom.createProductForm?.reset();
  if(dom.sizesInput && !dom.sizesInput.value.trim()) dom.sizesInput.value="S,M,L";
  if(dom.colorsInput && !dom.colorsInput.value.trim()) dom.colorsInput.value="奶油白";
  if(dom.stockInput && !dom.stockInput.value.trim()) dom.stockInput.value="12";
  if(dom.formEyebrow) dom.formEyebrow.textContent="Create";
  if(dom.formTitle) dom.formTitle.textContent="新增服裝商品";
  if(dom.submitProductButton) dom.submitProductButton.textContent="上架商品";
  core.toggleHidden(dom.cancelEditButton, true);
  uploadStatus("可直接在網站上選圖上傳，或改用下方圖片網址。");
  renderPreview();
}
function startEdit(productId){
  const product=state.products.find(p=>p.productId===Number(productId)); if(!product) return;
  state.editingProductId=product.productId;
  if(dom.productName) dom.productName.value=product.name;
  if(dom.productPrice) dom.productPrice.value = window.ethers.formatUnits(product.priceWei, Number(window.APP_CONFIG?.PAYMENT_TOKEN_DECIMALS || 6));
  if(dom.departmentSelect) dom.departmentSelect.value=product.meta.department;
  if(dom.seasonSelect) dom.seasonSelect.value=product.meta.season;
  if(dom.styleSelect) dom.styleSelect.value=product.meta.style;
  if(dom.sizesInput) dom.sizesInput.value=product.meta.sizes.join(",");
  if(dom.colorsInput) dom.colorsInput.value=product.meta.colors.join(",");
  if(dom.stockInput) dom.stockInput.value=String(product.meta.stock);
  if(dom.imageUrlInput) dom.imageUrlInput.value=product.meta.imageUrl || "";
  if(dom.descriptionInput) dom.descriptionInput.value=product.meta.description || "";
  if(dom.formEyebrow) dom.formEyebrow.textContent="Edit";
  if(dom.formTitle) dom.formTitle.textContent="編輯服裝商品";
  if(dom.submitProductButton) dom.submitProductButton.textContent="儲存變更";
  core.toggleHidden(dom.cancelEditButton, false);
  uploadStatus(`正在編輯商品 #${product.productId}`);
  renderPreview();
  const editPanel = dom.createProductForm?.closest(".seller-form-card");
  editPanel?.scrollIntoView({ behavior: "smooth", block: "start" });
  window.setTimeout(() => dom.productName?.focus(), 220);
}
function closeDeleteModal(answer = false){
  core.toggleHidden(dom.confirmDeleteModal, true);
  dom.confirmDeleteModal?.setAttribute("aria-hidden", "true");
  if(deleteResolver){
    deleteResolver(answer);
    deleteResolver = null;
  }
}
function confirmDeleteProduct(product){
  if(dom.confirmDeleteTitle) dom.confirmDeleteTitle.textContent = `確定要刪除「${product.name}」嗎？`;
  if(dom.confirmDeleteMessage) dom.confirmDeleteMessage.textContent = "刪除後無法復原，商品也會從商品管理與商店前台移除。";
  core.toggleHidden(dom.confirmDeleteModal, false);
  dom.confirmDeleteModal?.setAttribute("aria-hidden", "false");
  window.setTimeout(() => dom.confirmDeleteAccept?.focus(), 10);
  return new Promise((resolve) => {
    deleteResolver = resolve;
  });
}
function renderGovernance(){
  const products=state.products.filter(p=>String(p.seller).toLowerCase()===String(state.account||"").toLowerCase());
  core.setText(dom.inventoryCount, String(products.length));
  if(dom.governanceStrip) dom.governanceStrip.innerHTML = `
    <article class="metric-strip-item"><span>商品總數</span><strong>${products.length}</strong></article>
    <article class="metric-strip-item"><span>販售中</span><strong>${products.filter(p=>p.isActive).length}</strong></article>
    <article class="metric-strip-item"><span>低庫存</span><strong>${products.filter(p=>Number(p.meta.stock)<=3).length}</strong></article>
    <article class="metric-strip-item"><span>缺圖片</span><strong>${products.filter(p=>!p.meta.imageUrl).length}</strong></article>
    <article class="metric-strip-item"><span>缺敘述</span><strong>${products.filter(p=>!p.meta.description).length}</strong></article>`;
  if(dom.alertList){
    const alerts=[];
    products.forEach(p=>{
      if(!p.meta.description) alerts.push({level:"中", title:`${p.name} 需要處理`, desc:`商品 #${p.productId}：缺少敘述`});
      if(!p.meta.imageUrl) alerts.push({level:"中", title:`${p.name} 需要圖片`, desc:`商品 #${p.productId}：缺少圖片`});
      if(Number(p.meta.stock)<=3) alerts.push({level:"低", title:`${p.name} 庫存偏低`, desc:`商品 #${p.productId}：庫存 ${p.meta.stock}`});
    });
    dom.alertList.innerHTML = alerts.length ? alerts.map(a=>`<article class="alert-row"><span class="status-badge ${a.level==="中"?"warn":"neutral"}">${a.level}優先</span><div><strong>${a.title}</strong><p>${a.desc}</p></div><span class="tag-pill">建議處理</span></article>`).join("") : '<article class="alert-row"><span class="status-badge success">穩定</span><div><strong>目前沒有需要立即處理的商品警示</strong><p>商品資訊完整且沒有低庫存提醒。</p></div></article>';
  }
  if(dom.readinessChecklist){
    const items=[
      {done:!!state.account, title:"連接錢包", desc:"已進入商戶工作台。"},
      {done:!!state.session?.authenticated, title:"完成簽名登入", desc:"後端 session 已建立。"},
      {done:!!state.sellerProfile.approved, title:"通過商戶審核", desc:"已取得商品發布權限。"},
      {done:products.length>0, title:"建立至少一筆商品", desc:`目前已有 ${products.length} 筆商品。`},
      {done:products.some(p=>p.meta.description && p.meta.imageUrl), title:"至少一筆高品質刊登", desc:"請補齊圖片、敘述與合理庫存。"}
    ];
    dom.readinessChecklist.innerHTML = items.map((item,index)=>`<article class="checklist-row"><div class="status-badge ${item.done?'success':'warn'}">${item.done?'已完成':String(index+1)}</div><div><strong>${item.title}</strong><p>${item.desc}</p></div><span class="status-badge ${item.done?'success':'warn'}">${item.done?'已完成':'待處理'}</span></article>`).join("");
  }
}
function renderInventory(){
  if(!dom.inventoryGrid) return;
  const products=state.products.filter(p=>String(p.seller).toLowerCase()===String(state.account||"").toLowerCase());
  dom.inventoryGrid.innerHTML = products.length ? products.map(p=>`
    <article class="inventory-card inventory-card-wide">
      <img src="${p.image}" alt="${p.name}">
      <div class="inventory-meta">
        <div class="inventory-main">
          <div class="detail-tags">
            <span class="tag-pill">商品 #${p.productId}</span>
            <span class="tag-pill">${p.meta.department}</span>
            <span class="tag-pill">${p.meta.season}</span>
            <span class="tag-pill">${p.meta.style}</span>
          </div>
          <h3>${p.name}</h3>
          <p>${p.meta.description || "尚未填寫商品敘述。"}</p>
          <p>賣家：${core.formatAddress(p.seller)} ・ 庫存：${p.meta.stock}</p>
          <div class="detail-tags">
            <span class="tag-pill">${p.isActive ? "販售中" : "已下架"}</span>
            <span class="tag-pill">${p.meta.imageUrl ? "有圖片" : "缺圖片"}</span>
            <span class="tag-pill">${p.meta.description ? "有敘述" : "缺敘述"}</span>
          </div>
        </div>
        <div class="inventory-side">
          <strong>${core.formatEth(p.priceWei)}</strong>
          <div class="detail-actions">
            <button class="button ghost" data-edit="${p.productId}" type="button">編輯</button>
            <button class="button ${p.isActive ? 'ghost' : 'primary'}" data-toggle="${p.productId}" type="button">${p.isActive ? '下架' : '重新上架'}</button>
            <button class="button ghost" data-delete="${p.productId}" type="button">刪除</button>
          </div>
        </div>
      </div>
    </article>
  `).join("") : '<article class="panel-card"><strong>目前沒有商品</strong><p>建立第一筆商品後，這裡會顯示你的庫存清單。</p></article>';
}
async function hydrate(force=false){
  try{
    const { wallet } = await bootstrap.sync(force);
    const [products, sellerProfile, sellersStore] = await Promise.all([
      core.getProducts(force),
      core.getSellerProfile(wallet.account, force),
      core.getSellersStore(force)
    ]);
    state.products=products; state.sellerProfile = sellerProfile; state.sellerRequests = sellersStore.pending || [];
    renderAccess(); renderRequests(); renderPreview(); renderGovernance(); renderInventory();
  }catch(error){ toast("error", normalizeError(error)); }
}
async function handleSubmit(event){
  event.preventDefault();
  try{
    if(!state.account) throw new Error("請先連接錢包");
    const meta=buildMeta();
    const priceWei = core.parsePaymentAmount(dom.productPrice?.value);
    if(state.editingProductId){
      await core.updateProduct(state.editingProductId,{ name: dom.productName?.value, priceWei, meta });
      toast("success","商品已更新");
    }else{
      await core.createProduct({ seller: state.account, name: dom.productName?.value, priceWei, meta });
      toast("success","商品已成功上架");
    }
    resetForm();
    await hydrate(true);
  }catch(error){ toast("error", normalizeError(error)); }
}
async function handleInventoryClick(event){
  const editId = event.target.closest("[data-edit]")?.dataset.edit;
  const toggleId = event.target.closest("[data-toggle]")?.dataset.toggle;
  const deleteId = event.target.closest("[data-delete]")?.dataset.delete;
  try{
    if(editId){ startEdit(editId); return; }
    if(toggleId){
      const product=state.products.find(p=>p.productId===Number(toggleId)); if(!product) return;
      await core.setProductActive(product.productId, !product.isActive);
      toast("success", product.isActive ? "商品已下架" : "商品已重新上架");
      await hydrate(true);
      return;
    }
    if(deleteId){
      const product=state.products.find(p=>p.productId===Number(deleteId)); if(!product) return;
      const shouldDelete = await confirmDeleteProduct(product);
      if(!shouldDelete) return;
      await core.deleteProduct(product.productId);
      if(state.editingProductId === product.productId){
        resetForm();
      }
      toast("success", "商品已刪除");
      await hydrate(true);
    }
  }catch(error){ toast("error", normalizeError(error)); }
}
bootstrap.bind();
core.on(dom.requestSellerAccessButton,"click", async()=>{ try{ if(!state.account) throw new Error("請先連接錢包"); await core.requestSellerAccess(state.account); toast("success","已送出賣家資格申請"); await hydrate(true);}catch(e){ toast("error", normalizeError(e)); }});
core.on(dom.refreshRequestsButton,"click", ()=>hydrate(true));
core.on(dom.refreshInventoryButton,"click", ()=>hydrate(true));
core.on(dom.createProductForm,"submit", handleSubmit);
core.on(dom.cancelEditButton,"click", ()=>resetForm());
core.on(dom.inventoryGrid,"click", handleInventoryClick);
core.on(dom.confirmDeleteBackdrop,"click", ()=>closeDeleteModal(false));
core.on(dom.confirmDeleteCancel,"click", ()=>closeDeleteModal(false));
core.on(dom.confirmDeleteAccept,"click", ()=>closeDeleteModal(true));
document.addEventListener("keydown", (event)=>{
  if(event.key === "Escape" && !dom.confirmDeleteModal?.classList.contains("hidden")){
    closeDeleteModal(false);
  }
});
[dom.productName, dom.productPrice, dom.departmentSelect, dom.seasonSelect, dom.styleSelect, dom.sizesInput, dom.colorsInput, dom.stockInput, dom.imageUrlInput, dom.descriptionInput].forEach(el=>core.on(el,"input", renderPreview));
core.on(dom.imageFileInput, "change", async (event)=>{
  const file = event.target.files?.[0]; if(!file) return;
  try{ uploadStatus("圖片上傳中..."); const result=await core.uploadProductImage(file); if(dom.imageUrlInput) dom.imageUrlInput.value=result.url || ""; uploadStatus("圖片上傳完成","success"); renderPreview(); }catch(error){ uploadStatus(normalizeError(error),"error"); }
});
core.on(dom.sellerRequestsList,"click", async (event)=>{
  const approve = event.target.closest("[data-approve]")?.dataset.approve;
  const reject = event.target.closest("[data-reject]")?.dataset.reject;
  try{
    if(approve){ await core.approveSellerAccess(approve,true); toast("success","已核准賣家"); await hydrate(true); }
    if(reject){ await core.approveSellerAccess(reject,false); toast("success","已退回賣家申請"); await hydrate(true); }
  }catch(error){ toast("error", normalizeError(error)); }
});
