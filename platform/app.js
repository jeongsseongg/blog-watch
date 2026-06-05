/* ============================================================
 * 벨로르 비교견적 플랫폼 (통합 사이트)
 * 공개영역: 홈/후기/커뮤니티 열람 + 비교견적 요청(고객)
 * 업체영역: 승인된 업체만 — 들어온 견적 / 내 입찰
 * 관리자영역: 판매/후기/커뮤니티 관리 + 업체 승인
 * 백엔드: Supabase (인증/DB/실시간/스토리지)
 * ============================================================ */

const CONFIG = {
  brand: "벨로르",
  tagline: "명품시계 비교견적 · 매입 플랫폼",
  supabaseUrl: "https://iumsnacuxgssnnbckurq.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1bXNuYWN1eGdzc25uYmNrdXJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2NDQ5ODQsImV4cCI6MjA5NjIyMDk4NH0.lwej8g4YCaiYuoQSXczwRp6ez-X26DD5d1ycMkYwpIk",
  currency: "원",
  listingCategories: ["벨로르판매", "고객판매"],
  communityCategories: ["인사이트", "공지사항", "매입후기", "시세정보", "명품시계정보", "Q&A", "자유게시판", "이벤트"],
};

const sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);

const state = { user: null, profile: null, route: "home", notifChannel: null };

// ---- 유틸 ---------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };
const money = (n) => (n == null ? "-" : Number(n).toLocaleString("ko-KR") + CONFIG.currency);
const esc = (s) => (s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const nl2br = (s) => esc(s).replace(/\n/g, "<br>");
const when = (ts) => new Date(ts).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
const toast = (msg, ok = true) => {
  const t = el(`<div class="toast ${ok ? "toast-ok" : "toast-err"}">${esc(msg)}</div>`);
  document.body.appendChild(t); setTimeout(() => t.remove(), 3200);
};
const role = () => state.profile?.role || "guest";
const isAdmin = () => role() === "admin";
const isApprovedVendor = () => role() === "vendor" && state.profile?.approved;
const stars = (r) => "★★★★★".slice(0, r || 0) + "☆☆☆☆☆".slice(0, 5 - (r || 0));

// 사진 업로드 → 공개 URL 배열
async function uploadPhotos(files, max = 10) {
  const list = Array.from(files).slice(0, max);
  const urls = [];
  for (const file of list) {
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const path = `${state.user.id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from("photos").upload(path, file, { cacheControl: "3600", upsert: false });
    if (error) { toast("사진 업로드 실패: " + error.message, false); continue; }
    urls.push(sb.storage.from("photos").getPublicUrl(path).data.publicUrl);
  }
  return urls;
}
const gallery = (urls) => (urls && urls.length)
  ? `<div class="gallery">${urls.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="" loading="lazy"></a>`).join("")}</div>` : "";

// 사진 선택기 (타일 + "+" 버튼)
function createPhotoPicker(containerId, max = 10) {
  const root = $("#" + containerId); const files = [];
  const hidden = el(`<input type="file" accept="image/*" multiple style="display:none">`);
  root.appendChild(hidden);
  function draw() {
    [...root.querySelectorAll(".ptile,.padd")].forEach(n => n.remove());
    files.forEach((f, i) => root.appendChild(
      el(`<div class="ptile"><img src="${URL.createObjectURL(f)}" alt=""><button type="button" class="prem" data-i="${i}">×</button></div>`)));
    if (files.length < max) {
      const add = el(`<button type="button" class="padd" title="사진 추가">+</button>`);
      add.addEventListener("click", () => hidden.click()); root.appendChild(add);
    }
    root.querySelectorAll(".prem").forEach(b =>
      b.addEventListener("click", () => { files.splice(+b.dataset.i, 1); draw(); }));
  }
  hidden.addEventListener("change", () => {
    for (const f of hidden.files) if (files.length < max) files.push(f);
    hidden.value = ""; if (files.length >= max) toast(`사진은 최대 ${max}장까지예요.`, false); draw();
  });
  draw(); return { files };
}

// ============================================================
// 인증
// ============================================================
async function signUp(email, password, displayName, userRole, companyName) {
  const { error } = await sb.auth.signUp({
    email, password,
    options: { data: { display_name: displayName, role: userRole, company_name: companyName || null } },
  });
  if (error) return toast(error.message, false);
  toast(userRole === "vendor" ? "가입 완료! 관리자 승인 후 이용할 수 있어요." : "가입 완료! 로그인해 주세요.");
  location.hash = "#login";
}
async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return toast(error.message, false);
  toast("로그인되었습니다."); location.hash = "#home";
}
async function oauth(provider) {
  const { error } = await sb.auth.signInWithOAuth({
    provider, options: { redirectTo: location.origin + location.pathname },
  });
  if (error) toast(error.message, false);
}
async function signOut() {
  await sb.auth.signOut(); state.user = null; state.profile = null; location.hash = "#home";
}
async function loadProfile() {
  if (!state.user) { state.profile = null; return; }
  const { data } = await sb.from("profiles").select("*").eq("id", state.user.id).single();
  state.profile = data;
}

// ============================================================
// 알림 (실시간)
// ============================================================
async function refreshNotifBadge() {
  const badge = $("#notif-badge"); if (!badge) return;
  if (!state.user) { badge.style.display = "none"; return; }
  const { count } = await sb.from("notifications")
    .select("*", { count: "exact", head: true }).eq("user_id", state.user.id).eq("is_read", false);
  badge.textContent = count ? String(count) : ""; badge.style.display = count ? "inline-flex" : "none";
}
function subscribeNotifications() {
  if (state.notifChannel) sb.removeChannel(state.notifChannel);
  if (!state.user) return;
  state.notifChannel = sb.channel("notif:" + state.user.id)
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${state.user.id}` },
      (p) => { toast("🔔 " + (p.new.title || "새 알림")); refreshNotifBadge(); if (state.route === "notifications") render(); })
    .subscribe();
}

// ============================================================
// 라우터 / 네비게이션
// ============================================================
function navLinks() {
  const r = role();
  const links = [["home", "홈"], ["reviews", "후기"], ["community", "커뮤니티"]];
  if (r === "customer") links.push(["new-quote", "견적 요청"], ["my-quotes", "내 비교견적"]);
  if (isApprovedVendor()) links.push(["vendor-quotes", "들어온 견적"], ["my-bids", "내 입찰"]);
  if (r === "admin") links.push(["admin", "관리자"], ["admin-listings", "판매관리"],
                                ["admin-reviews", "후기관리"], ["admin-quotes", "견적관리"]);
  return links.map(([h, t]) => `<a href="#${h}" class="${state.route === h ? "active" : ""}">${t}</a>`).join("");
}
function renderNav() {
  const r = role();
  const auth = state.user
    ? `<button id="bell" class="bell" title="알림">🔔<span id="notif-badge" class="badge"></span></button>
       <span class="who">${esc(state.profile?.display_name || "")} <em>(${r}${r === "vendor" && !state.profile?.approved ? "·대기" : ""})</em></span>
       <button id="logout" class="btn-ghost">로그아웃</button>`
    : `<a href="#login" class="btn-ghost">로그인</a><a href="#signup" class="btn">회원가입</a>`;
  $("#nav").innerHTML =
    `<a href="#home" class="brand">${esc(CONFIG.brand)}</a>
     <nav class="links">${navLinks()}</nav><div class="auth">${auth}</div>`;
  $("#logout")?.addEventListener("click", signOut);
  $("#bell")?.addEventListener("click", () => location.hash = "#notifications");
  refreshNotifBadge();
}

const needLogin = () => `<div class="card">로그인이 필요합니다. <a href="#login">로그인</a></div>`;
const onlyAdmin = () => `<div class="card err">관리자 전용 메뉴입니다.</div>`;
const vendorPending = () => `<div class="card"><h3>승인 대기 중</h3>
  <p class="muted">업체 회원은 관리자 승인 후 견적·입찰 메뉴를 이용할 수 있어요. 승인되면 알림으로 안내됩니다.</p></div>`;

async function render() {
  renderNav();
  const main = $("#view"); main.innerHTML = `<div class="loading">불러오는 중…</div>`;
  const r = state.route;
  try {
    // 공개
    if (r === "home") return viewHome(main);
    if (r === "reviews") return viewReviews(main);
    if (r === "community") return viewCommunity(main);
    if (r === "login") return viewLogin(main);
    if (r === "signup") return viewSignup(main);
    // 로그인 필요
    if (!state.user) { main.innerHTML = needLogin(); return; }
    if (r === "notifications") return viewNotifications(main);
    // 고객
    if (r === "new-quote") return viewNewQuote(main);
    if (r === "my-quotes") return viewMyQuotes(main);
    // 업체 (승인 필요)
    if (r === "vendor-quotes" || r === "my-bids") {
      if (role() !== "vendor") { main.innerHTML = `<div class="card err">업체 전용 메뉴입니다.</div>`; return; }
      if (!state.profile?.approved) { main.innerHTML = vendorPending(); return; }
      return r === "vendor-quotes" ? viewVendorQuotes(main) : viewMyBids(main);
    }
    // 관리자
    if (["admin", "admin-listings", "admin-reviews", "admin-quotes"].includes(r)) {
      if (!isAdmin()) { main.innerHTML = onlyAdmin(); return; }
      if (r === "admin") return viewAdmin(main);
      if (r === "admin-listings") return viewAdminListings(main);
      if (r === "admin-reviews") return viewAdminReviews(main);
      if (r === "admin-quotes") return viewAdminQuotes(main);
    }
    viewHome(main);
  } catch (e) { main.innerHTML = `<div class="card err">오류: ${esc(e.message)}</div>`; }
}

// ============================================================
// 공개: 홈
// ============================================================
async function viewHome(main) {
  const [{ data: listings }, { data: reviews }] = await Promise.all([
    sb.from("listings").select("*").eq("status", "on_sale").order("created_at", { ascending: false }).limit(50),
    sb.from("reviews").select("*").order("created_at", { ascending: false }).limit(3),
  ]);
  const cats = ["전체", ...CONFIG.listingCategories];
  main.innerHTML = `
    <section class="hero">
      <h1>${esc(CONFIG.brand)}</h1>
      <p>${esc(CONFIG.tagline)}</p>
      <a href="#${state.user ? (role() === "customer" ? "new-quote" : "home") : "signup"}" class="btn btn-lg" style="width:auto">지금 비교견적 받기</a>
    </section>
    <div class="row between"><h2>판매중인 시계</h2></div>
    <div class="tabs" id="ltabs">${cats.map((c, i) => `<button class="tab ${i === 0 ? "active" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("")}</div>
    <div class="grid" id="lgrid"></div>
    <div class="row between" style="margin-top:24px"><h2>고객 후기</h2><a href="#reviews">전체 보기</a></div>
    <div class="grid">${(reviews || []).map(reviewCard).join("") || `<p class="muted">등록된 후기가 없습니다.</p>`}</div>`;
  const drawL = (cat) => {
    const items = cat === "전체" ? (listings || []) : (listings || []).filter(l => (l.category || "벨로르판매") === cat);
    $("#lgrid").innerHTML = items.length ? items.map(listingCard).join("") : `<p class="muted">해당 카테고리에 시계가 없습니다.</p>`;
  };
  drawL("전체");
  main.querySelectorAll("#ltabs .tab").forEach(b => b.addEventListener("click", () => {
    main.querySelectorAll("#ltabs .tab").forEach(x => x.classList.remove("active"));
    b.classList.add("active"); drawL(b.dataset.cat);
  }));
}
const listingCard = (l) => `
  <div class="card listing">
    ${(l.image_urls?.[0] || l.image_url) ? `<img src="${esc(l.image_urls?.[0] || l.image_url)}" alt="">` : `<div class="noimg">이미지 없음</div>`}
    <p><span class="tag tag-cat">${esc(l.category || "벨로르판매")}</span></p>
    <h3>${esc(l.title)}</h3>
    <p class="price">${money(l.price)} <span class="tag tag-${l.status}">${l.status}</span></p>
    <p class="muted small">${esc((l.description || "").slice(0, 60))}</p>
  </div>`;
const reviewCard = (rv) => `
  <div class="card">
    <p class="stars">${stars(rv.rating)}</p>
    <h3>${esc(rv.title)}</h3>
    <p class="muted small">${esc(rv.author_name || "익명")} · ${when(rv.created_at)}</p>
    <p>${nl2br((rv.body || "").slice(0, 120))}</p>
    ${gallery(rv.image_urls)}
  </div>`;

// ============================================================
// 공개: 후기
// ============================================================
async function viewReviews(main) {
  const { data: reviews } = await sb.from("reviews").select("*").order("created_at", { ascending: false });
  main.innerHTML = `<h2>고객 후기</h2>${(reviews || []).map(reviewCard).join("") || `<p class="muted">아직 후기가 없습니다.</p>`}`;
}

// ============================================================
// 로그인 / 회원가입 (이메일 + 구글/카카오)
// ============================================================
const oauthButtons = `
  <div class="oauth">
    <button class="btn-oauth google" id="oauth-google"><span>G</span> Google로 계속하기</button>
    <button class="btn-oauth kakao" id="oauth-kakao"><span>K</span> 카카오로 계속하기</button>
  </div>
  <div class="divider"><span>또는 이메일</span></div>`;
function wireOauth() {
  $("#oauth-google")?.addEventListener("click", () => oauth("google"));
  $("#oauth-kakao")?.addEventListener("click", () => oauth("kakao"));
}
function viewLogin(main) {
  main.innerHTML = `
    <div class="card form-card">
      <h2>로그인</h2>
      ${oauthButtons}
      <label>이메일<input id="email" type="email" autocomplete="email"></label>
      <label>비밀번호<input id="pw" type="password" autocomplete="current-password"></label>
      <button id="do-login" class="btn btn-lg">로그인</button>
      <p class="muted">계정이 없으신가요? <a href="#signup">회원가입</a></p>
    </div>`;
  wireOauth();
  $("#do-login").addEventListener("click", () => signIn($("#email").value.trim(), $("#pw").value));
}
function viewSignup(main) {
  main.innerHTML = `
    <div class="card form-card">
      <h2>회원가입</h2>
      ${oauthButtons}
      <label>가입 유형
        <select id="role">
          <option value="customer">일반회원 (비교견적 요청)</option>
          <option value="vendor">업체회원 (승인 후 입찰 참여)</option>
        </select>
      </label>
      <label>이름/닉네임<input id="name"></label>
      <label class="vendor-only" style="display:none">업체 상호<input id="company"></label>
      <label>이메일<input id="email" type="email"></label>
      <label>비밀번호 (6자 이상)<input id="pw" type="password"></label>
      <button id="do-signup" class="btn btn-lg">가입하기</button>
      <p class="muted small">※ 업체회원은 관리자 승인 후 이용 가능합니다. 관리자 계정은 README 참고.</p>
    </div>`;
  wireOauth();
  $("#role").addEventListener("change", e => $(".vendor-only").style.display = e.target.value === "vendor" ? "block" : "none");
  $("#do-signup").addEventListener("click", () =>
    signUp($("#email").value.trim(), $("#pw").value, $("#name").value.trim(), $("#role").value, $("#company").value.trim()));
}

// ============================================================
// 고객: 비교견적 요청
// ============================================================
function viewNewQuote(main) {
  if (role() !== "customer") { main.innerHTML = `<div class="card">일반회원만 견적을 요청할 수 있어요.</div>`; return; }
  main.innerHTML = `
    <div class="card form-card">
      <h2>비교견적 요청</h2>
      <p class="muted">요청하면 관리자 확인(승인) 후 업체들에게 전달되어 입찰이 진행됩니다.</p>
      <label>품목명 *<input id="item_name" placeholder="예: 롤렉스 서브마리너 126610LN"></label>
      <label>브랜드<input id="item_brand" placeholder="예: 롤렉스"></label>
      <label>상세 설명<textarea id="item_detail" rows="4" placeholder="상태, 구성품, 구매시기 등"></textarea></label>
      <label>사진 (최대 10장)</label>
      <div id="photos" class="photo-grid"></div>
      <button id="submit" class="btn btn-lg">견적 요청 등록</button>
    </div>`;
  const picker = createPhotoPicker("photos", 10);
  $("#submit").addEventListener("click", async () => {
    const item_name = $("#item_name").value.trim();
    if (!item_name) return toast("품목명을 입력하세요.", false);
    const btn = $("#submit"); btn.disabled = true; btn.textContent = "사진 올리는 중…";
    const photo_urls = await uploadPhotos(picker.files, 10);
    const { error } = await sb.from("quote_requests").insert({
      customer_id: state.user.id, item_name, status: "pending",
      item_brand: $("#item_brand").value.trim() || null,
      item_detail: $("#item_detail").value.trim() || null,
      photo_urls, photo_url: photo_urls[0] || null,
    });
    btn.disabled = false; btn.textContent = "견적 요청 등록";
    if (error) return toast(error.message, false);
    toast("요청 완료! 관리자 승인 후 업체에게 전달됩니다."); location.hash = "#my-quotes";
  });
}

// ============================================================
// 고객: 내 비교견적 + 입찰 비교
// ============================================================
async function viewMyQuotes(main) {
  const { data: quotes } = await sb.from("quote_requests")
    .select("*").eq("customer_id", state.user.id).order("created_at", { ascending: false });
  if (!quotes?.length) { main.innerHTML = `<div class="card">아직 요청한 비교견적이 없습니다. <a href="#new-quote">요청하기</a></div>`; return; }
  const ids = quotes.map(q => q.id);
  const { data: bids } = await sb.from("bids").select("*").in("quote_request_id", ids).order("amount", { ascending: false });
  const byQuote = {}; (bids || []).forEach(b => (byQuote[b.quote_request_id] ||= []).push(b));
  main.innerHTML = `<h2>내 비교견적</h2>` + quotes.map(q => {
    const list = byQuote[q.id] || []; const best = list[0];
    return `<div class="card">
      <div class="row between"><h3>${esc(q.item_name)} <span class="tag tag-${q.status}">${q.status}</span></h3>
        <span class="muted small">${when(q.created_at)}</span></div>
      ${q.item_detail ? `<p class="muted">${esc(q.item_detail)}</p>` : ""}
      ${gallery(q.photo_urls?.length ? q.photo_urls : (q.photo_url ? [q.photo_url] : []))}
      <h4>받은 입찰 ${list.length}건 ${best ? `· 최고가 <b>${money(best.amount)}</b>` : ""}</h4>
      ${list.length ? `<table class="bids"><tr><th>금액</th><th>메시지</th><th>일시</th><th></th></tr>
        ${list.map(b => `<tr><td><b>${money(b.amount)}</b></td><td>${esc(b.message || "-")}</td>
          <td class="muted small">${when(b.created_at)}</td>
          <td>${q.status === "open" ? `<button class="btn-sm award" data-q="${q.id}" data-b="${b.id}">채택</button>`
              : (q.awarded_bid === b.id ? `<span class="tag tag-awarded">채택됨</span>` : "")}</td></tr>`).join("")}
      </table>` : `<p class="muted">아직 입찰이 없습니다.</p>`}
    </div>`;
  }).join("");
  main.querySelectorAll(".award").forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm("이 입찰을 채택하시겠어요? 견적이 마감됩니다.")) return;
    const { error } = await sb.from("quote_requests").update({ status: "awarded", awarded_bid: btn.dataset.b }).eq("id", btn.dataset.q);
    if (error) return toast(error.message, false);
    toast("입찰을 채택했습니다."); render();
  }));
}

// ============================================================
// 업체: 들어온 견적 + 입찰
// ============================================================
async function viewVendorQuotes(main) {
  const { data: quotes } = await sb.from("quote_requests").select("*").eq("status", "open").order("created_at", { ascending: false });
  const { data: myBids } = await sb.from("bids").select("*").eq("vendor_id", state.user.id);
  const mine = {}; (myBids || []).forEach(b => mine[b.quote_request_id] = b);
  main.innerHTML = `<h2>들어온 견적</h2>` + ((quotes || []).map(q => {
    const b = mine[q.id];
    return `<div class="card">
      <h3>${esc(q.item_name)} ${q.item_brand ? `<span class="muted">/ ${esc(q.item_brand)}</span>` : ""}</h3>
      ${q.item_detail ? `<p class="muted">${esc(q.item_detail)}</p>` : ""}
      ${gallery(q.photo_urls?.length ? q.photo_urls : (q.photo_url ? [q.photo_url] : []))}
      ${b ? `<p class="bidded">내 입찰가: ${money(b.amount)} ${b.message ? `· ${esc(b.message)}` : ""}</p>`
        : `<div class="bid-form">
             <input type="number" class="bid-amount" placeholder="입찰 금액 (${CONFIG.currency})" data-q="${q.id}">
             <input type="text" class="bid-msg" placeholder="메시지 (선택)" data-q="${q.id}">
             <button class="btn place-bid" data-q="${q.id}">입찰하기</button></div>`}
    </div>`;
  }).join("") || `<p class="muted">현재 진행중인 견적이 없습니다.</p>`);
  main.querySelectorAll(".place-bid").forEach(btn => btn.addEventListener("click", async () => {
    const q = btn.dataset.q;
    const amount = Number($(`.bid-amount[data-q="${q}"]`).value);
    const message = $(`.bid-msg[data-q="${q}"]`).value.trim();
    if (!amount || amount <= 0) return toast("입찰 금액을 입력하세요.", false);
    const { error } = await sb.from("bids").insert({ quote_request_id: q, vendor_id: state.user.id, amount, message: message || null });
    if (error) return toast(error.message, false);
    toast("입찰이 등록되었습니다."); render();
  }));
}

// ============================================================
// 업체: 내 입찰
// ============================================================
async function viewMyBids(main) {
  const { data: bids } = await sb.from("bids")
    .select("*, quote_requests(item_name, status, awarded_bid)").eq("vendor_id", state.user.id).order("created_at", { ascending: false });
  main.innerHTML = `<h2>내 입찰</h2>` + ((bids || []).map(b => {
    const q = b.quote_requests || {}; const won = q.awarded_bid === b.id;
    return `<div class="card">
      <div class="row between"><h3>${esc(q.item_name || "(삭제된 견적)")}</h3>
        ${won ? `<span class="tag tag-awarded">낙찰 🎉</span>` : `<span class="tag tag-${q.status}">${q.status || "-"}</span>`}</div>
      <p>입찰가 <b>${money(b.amount)}</b> ${b.message ? `· ${esc(b.message)}` : ""}</p>
      <p class="muted small">${when(b.created_at)}</p></div>`;
  }).join("") || `<p class="muted">아직 입찰한 견적이 없습니다.</p>`);
}

// ============================================================
// 공개: 커뮤니티 (조회 누구나 / 작성·수정·삭제 관리자만)
// ============================================================
async function viewCommunity(main) {
  const { data: posts } = await sb.from("community_posts")
    .select("*, profiles(display_name)").order("created_at", { ascending: false });
  const cats = ["전체", ...CONFIG.communityCategories];
  main.innerHTML = `<div class="row between"><h2>커뮤니티</h2>
      ${isAdmin() ? `<button id="write" class="btn">+ 글쓰기</button>` : ""}</div>
    <div class="tabs" id="ctabs">${cats.map((c, i) => `<button class="tab ${i === 0 ? "active" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("")}</div>
    <div id="post-editor"></div>
    <div id="post-list"></div>`;
  const postCard = (p) => `<div class="card post">
        <div class="row between"><h3><span class="tag tag-cat">${esc(p.category || "자유게시판")}</span> ${esc(p.title)}</h3>
          ${isAdmin() ? `<div class="row"><button class="btn-sm edit-post" data-id="${p.id}">수정</button>
            <button class="btn-sm danger del-post" data-id="${p.id}">삭제</button></div>` : ""}</div>
        <p class="muted small">${esc(p.profiles?.display_name || "관리자")} · ${when(p.created_at)}</p>
        <p>${nl2br(p.body || "")}</p></div>`;
  const map = {}; (posts || []).forEach(p => map[p.id] = p);
  const drawPosts = (cat) => {
    const items = cat === "전체" ? (posts || []) : (posts || []).filter(p => (p.category || "자유게시판") === cat);
    $("#post-list").innerHTML = items.length ? items.map(postCard).join("") : `<p class="muted">이 카테고리에 글이 없습니다.</p>`;
    wirePostButtons();
  };
  const wirePostButtons = () => {
    if (!isAdmin()) return;
    $("#post-list").querySelectorAll(".edit-post").forEach(b => b.addEventListener("click", () => editor(map[b.dataset.id])));
    $("#post-list").querySelectorAll(".del-post").forEach(b => b.addEventListener("click", async () => {
      if (!confirm("삭제하시겠어요?")) return;
      const { error } = await sb.from("community_posts").delete().eq("id", b.dataset.id);
      if (error) return toast(error.message, false); toast("삭제했습니다."); render();
    }));
  };
  const editor = (post) => {
    $("#post-editor").innerHTML = `<div class="card form-card">
      <h3>${post ? "글 수정" : "새 글 작성"}</h3>
      <label>카테고리<select id="p_cat">${CONFIG.communityCategories.map(c => `<option ${post?.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></label>
      <label>제목 *<input id="p_title" value="${esc(post?.title || "")}"></label>
      <label>내용<textarea id="p_body" rows="5">${esc(post?.body || "")}</textarea></label>
      <div class="row"><button id="p_save" class="btn">저장</button><button id="p_cancel" class="btn-ghost">취소</button></div></div>`;
    $("#p_cancel").addEventListener("click", () => $("#post-editor").innerHTML = "");
    $("#p_save").addEventListener("click", async () => {
      const title = $("#p_title").value.trim(), body = $("#p_body").value.trim(), category = $("#p_cat").value;
      if (!title) return toast("제목을 입력하세요.", false);
      const res = post
        ? await sb.from("community_posts").update({ title, body, category, updated_at: new Date().toISOString() }).eq("id", post.id)
        : await sb.from("community_posts").insert({ author_id: state.user.id, title, body, category });
      if (res.error) return toast(res.error.message, false);
      toast("저장되었습니다."); render();
    });
  };
  drawPosts("전체");
  main.querySelectorAll("#ctabs .tab").forEach(b => b.addEventListener("click", () => {
    main.querySelectorAll("#ctabs .tab").forEach(x => x.classList.remove("active"));
    b.classList.add("active"); drawPosts(b.dataset.cat);
  }));
  if (!isAdmin()) return;
  $("#write")?.addEventListener("click", () => editor(null));
}

// ============================================================
// 알림
// ============================================================
async function viewNotifications(main) {
  const { data: notifs } = await sb.from("notifications")
    .select("*").eq("user_id", state.user.id).order("created_at", { ascending: false }).limit(50);
  main.innerHTML = `<div class="row between"><h2>알림</h2><button id="read-all" class="btn-ghost">모두 읽음</button></div>` +
    ((notifs || []).map(n => `<div class="card notif ${n.is_read ? "" : "unread"}">
        <b>${esc(n.title || "")}</b> <span class="muted small">${when(n.created_at)}</span>
        <p>${esc(n.body || "")}</p></div>`).join("") || `<p class="muted">알림이 없습니다.</p>`);
  const unread = (notifs || []).filter(n => !n.is_read).map(n => n.id);
  if (unread.length) { await sb.from("notifications").update({ is_read: true }).in("id", unread); refreshNotifBadge(); }
  $("#read-all").addEventListener("click", async () => {
    await sb.from("notifications").update({ is_read: true }).eq("user_id", state.user.id).eq("is_read", false);
    toast("모두 읽음 처리했습니다."); render();
  });
}

// ============================================================
// 관리자: 대시보드 + 업체 승인
// ============================================================
async function viewAdmin(main) {
  const [{ count: users }, { count: quotes }, { count: bids }, { count: posts }] = await Promise.all([
    sb.from("profiles").select("*", { count: "exact", head: true }),
    sb.from("quote_requests").select("*", { count: "exact", head: true }),
    sb.from("bids").select("*", { count: "exact", head: true }),
    sb.from("community_posts").select("*", { count: "exact", head: true }),
  ]);
  const { data: vendors } = await sb.from("profiles").select("*").eq("role", "vendor").order("created_at", { ascending: false });
  main.innerHTML = `
    <h2>관리자 대시보드</h2>
    <div class="stats">
      <div class="stat"><b>${users ?? 0}</b><span>회원</span></div>
      <div class="stat"><b>${quotes ?? 0}</b><span>비교견적</span></div>
      <div class="stat"><b>${bids ?? 0}</b><span>입찰</span></div>
      <div class="stat"><b>${posts ?? 0}</b><span>게시글</span></div>
    </div>
    <h3>업체 회원 승인</h3>
    <table class="bids"><tr><th>상호/이름</th><th>상태</th><th>가입일</th><th></th></tr>
      ${(vendors || []).map(v => `<tr>
        <td>${esc(v.company_name || v.display_name || "-")}</td>
        <td>${v.approved ? `<span class="tag tag-awarded">승인됨</span>` : `<span class="tag tag-open">대기</span>`}</td>
        <td class="muted small">${when(v.created_at)}</td>
        <td>${v.approved
            ? `<button class="btn-sm vtoggle" data-id="${v.id}" data-to="false">승인취소</button>`
            : `<button class="btn-sm vtoggle" data-id="${v.id}" data-to="true">승인</button>`}</td></tr>`).join("") || `<tr><td colspan="4" class="muted">업체 회원이 없습니다.</td></tr>`}
    </table>`;
  main.querySelectorAll(".vtoggle").forEach(b => b.addEventListener("click", async () => {
    const to = b.dataset.to === "true";
    const { error } = await sb.from("profiles").update({ approved: to }).eq("id", b.dataset.id);
    if (error) return toast(error.message, false);
    if (to) await sb.from("notifications").insert({ user_id: b.dataset.id, type: "approved", title: "업체 승인 완료", body: "이제 견적 확인·입찰이 가능합니다." });
    toast(to ? "승인했습니다." : "승인을 취소했습니다."); render();
  }));
}

// ============================================================
// 관리자: 판매중 시계 관리
// ============================================================
async function viewAdminListings(main) {
  const { data: items } = await sb.from("listings").select("*").order("created_at", { ascending: false });
  main.innerHTML = `<div class="row between"><h2>판매중 시계 관리</h2><button id="add" class="btn">+ 새 시계 등록</button></div>
    <div id="editor"></div>
    <div class="grid">${(items || []).map(l => `<div class="card listing">
        ${(l.image_urls?.[0] || l.image_url) ? `<img src="${esc(l.image_urls?.[0] || l.image_url)}" alt="">` : `<div class="noimg">이미지 없음</div>`}
        <p><span class="tag tag-cat">${esc(l.category || "벨로르판매")}</span></p>
        <h3>${esc(l.title)}</h3>
        <p class="price">${money(l.price)} <span class="tag tag-${l.status}">${l.status}</span></p>
        <div class="row"><button class="btn-sm edit" data-id="${l.id}">수정</button>
          <button class="btn-sm danger del" data-id="${l.id}">삭제</button></div></div>`).join("") || `<p class="muted">등록된 시계가 없습니다.</p>`}</div>`;
  const map = {}; (items || []).forEach(i => map[i.id] = i);
  const editor = (item) => {
    $("#editor").innerHTML = `<div class="card form-card">
      <h3>${item ? "시계 수정" : "새 시계 등록"}</h3>
      <label>제목 *<input id="f_title" value="${esc(item?.title || "")}"></label>
      <label>카테고리<select id="f_cat">${CONFIG.listingCategories.map(c => `<option ${item?.category === c ? "selected" : ""}>${c}</option>`).join("")}</select></label>
      <label>가격<input id="f_price" type="number" value="${item?.price ?? ""}"></label>
      <label>설명<textarea id="f_desc" rows="3">${esc(item?.description || "")}</textarea></label>
      <label>사진 추가 (최대 10장)</label><div id="f_photos" class="photo-grid"></div>
      ${(item?.image_urls?.length) ? `<p class="muted small">기존 사진 ${item.image_urls.length}장 유지됨</p>${gallery(item.image_urls)}` : ""}
      <label>상태<select id="f_status">${["on_sale", "sold", "hidden"].map(s => `<option ${item?.status === s ? "selected" : ""}>${s}</option>`).join("")}</select></label>
      <div class="row"><button id="save" class="btn">저장</button><button id="cancel" class="btn-ghost">취소</button></div></div>`;
    const lpicker = createPhotoPicker("f_photos", 10);
    $("#cancel").addEventListener("click", () => $("#editor").innerHTML = "");
    $("#save").addEventListener("click", async () => {
      const save = $("#save"); save.disabled = true; save.textContent = "저장 중…";
      const existing = item?.image_urls || []; const newUrls = await uploadPhotos(lpicker.files, 10);
      const image_urls = [...existing, ...newUrls].slice(0, 10);
      const payload = {
        owner_id: state.user.id, title: $("#f_title").value.trim(),
        category: $("#f_cat").value,
        price: $("#f_price").value ? Number($("#f_price").value) : null,
        description: $("#f_desc").value.trim() || null,
        image_urls, image_url: image_urls[0] || null,
        status: $("#f_status").value, updated_at: new Date().toISOString(),
      };
      if (!payload.title) { save.disabled = false; save.textContent = "저장"; return toast("제목을 입력하세요.", false); }
      const res = item ? await sb.from("listings").update(payload).eq("id", item.id) : await sb.from("listings").insert(payload);
      if (res.error) { save.disabled = false; save.textContent = "저장"; return toast(res.error.message, false); }
      toast("저장되었습니다."); render();
    });
  };
  $("#add").addEventListener("click", () => editor(null));
  main.querySelectorAll(".edit").forEach(b => b.addEventListener("click", () => editor(map[b.dataset.id])));
  main.querySelectorAll(".del").forEach(b => b.addEventListener("click", async () => {
    if (!confirm("삭제하시겠어요?")) return;
    const { error } = await sb.from("listings").delete().eq("id", b.dataset.id);
    if (error) return toast(error.message, false); toast("삭제했습니다."); render();
  }));
}

// ============================================================
// 관리자: 후기 관리
// ============================================================
async function viewAdminReviews(main) {
  const { data: reviews } = await sb.from("reviews").select("*").order("created_at", { ascending: false });
  main.innerHTML = `<div class="row between"><h2>후기 관리</h2><button id="add" class="btn">+ 후기 등록</button></div>
    <div id="editor"></div>
    ${(reviews || []).map(rv => `<div class="card">
        <div class="row between"><h3>${stars(rv.rating)} ${esc(rv.title)}</h3>
          <div class="row"><button class="btn-sm edit" data-id="${rv.id}">수정</button>
            <button class="btn-sm danger del" data-id="${rv.id}">삭제</button></div></div>
        <p class="muted small">${esc(rv.author_name || "익명")} · ${when(rv.created_at)}</p>
        <p>${nl2br(rv.body || "")}</p>${gallery(rv.image_urls)}</div>`).join("") || `<p class="muted">등록된 후기가 없습니다.</p>`}`;
  const map = {}; (reviews || []).forEach(r => map[r.id] = r);
  const editor = (rv) => {
    $("#editor").innerHTML = `<div class="card form-card">
      <h3>${rv ? "후기 수정" : "후기 등록"}</h3>
      <label>제목 *<input id="r_title" value="${esc(rv?.title || "")}"></label>
      <label>작성자명<input id="r_author" value="${esc(rv?.author_name || "")}"></label>
      <label>별점<select id="r_rating">${[5, 4, 3, 2, 1].map(n => `<option value="${n}" ${rv?.rating === n ? "selected" : ""}>${stars(n)} (${n})</option>`).join("")}</select></label>
      <label>내용<textarea id="r_body" rows="4">${esc(rv?.body || "")}</textarea></label>
      <label>사진 추가 (최대 10장)</label><div id="r_photos" class="photo-grid"></div>
      ${(rv?.image_urls?.length) ? gallery(rv.image_urls) : ""}
      <div class="row"><button id="r_save" class="btn">저장</button><button id="r_cancel" class="btn-ghost">취소</button></div></div>`;
    const rpicker = createPhotoPicker("r_photos", 10);
    $("#r_cancel").addEventListener("click", () => $("#editor").innerHTML = "");
    $("#r_save").addEventListener("click", async () => {
      const title = $("#r_title").value.trim();
      if (!title) return toast("제목을 입력하세요.", false);
      const existing = rv?.image_urls || []; const newUrls = await uploadPhotos(rpicker.files, 10);
      const image_urls = [...existing, ...newUrls].slice(0, 10);
      const payload = { title, author_name: $("#r_author").value.trim() || null, rating: Number($("#r_rating").value), body: $("#r_body").value.trim() || null, image_urls };
      const res = rv ? await sb.from("reviews").update(payload).eq("id", rv.id) : await sb.from("reviews").insert(payload);
      if (res.error) return toast(res.error.message, false);
      toast("저장되었습니다."); render();
    });
  };
  $("#add").addEventListener("click", () => editor(null));
  main.querySelectorAll(".edit").forEach(b => b.addEventListener("click", () => editor(map[b.dataset.id])));
  main.querySelectorAll(".del").forEach(b => b.addEventListener("click", async () => {
    if (!confirm("삭제하시겠어요?")) return;
    const { error } = await sb.from("reviews").delete().eq("id", b.dataset.id);
    if (error) return toast(error.message, false); toast("삭제했습니다."); render();
  }));
}

// ============================================================
// 관리자: 견적 관리 (전체 견적 + 입찰 현황)
// ============================================================
async function viewAdminQuotes(main) {
  const { data: quotes } = await sb.from("quote_requests").select("*, profiles(display_name)").order("created_at", { ascending: false });
  const ids = (quotes || []).map(q => q.id);
  const { data: bids } = ids.length ? await sb.from("bids").select("*").in("quote_request_id", ids).order("amount", { ascending: false }) : { data: [] };
  const byQ = {}; (bids || []).forEach(b => (byQ[b.quote_request_id] ||= []).push(b));
  const pending = (quotes || []).filter(q => q.status === "pending");
  const others = (quotes || []).filter(q => q.status !== "pending");
  const card = (q) => {
    const list = byQ[q.id] || []; const best = list[0];
    return `<div class="card">
      <div class="row between"><h3>${esc(q.item_name)} ${q.item_brand ? `<span class="muted">/ ${esc(q.item_brand)}</span>` : ""}
        <span class="tag tag-${q.status}">${q.status}</span></h3>
        <span class="muted small">${esc(q.profiles?.display_name || "-")} · ${when(q.created_at)}</span></div>
      ${q.item_detail ? `<p class="muted">${esc(q.item_detail)}</p>` : ""}
      ${gallery(q.photo_urls?.length ? q.photo_urls : (q.photo_url ? [q.photo_url] : []))}
      ${q.status === "pending" ? `<button class="btn approve-q" data-id="${q.id}">승인 → 업체에 전달</button>`
        : `<h4>입찰 ${list.length}건 ${best ? `· 최고가 <b>${money(best.amount)}</b>` : ""}</h4>
           ${list.length ? `<table class="bids"><tr><th>업체</th><th>금액</th><th>메시지</th><th>일시</th></tr>
             ${list.map(b => `<tr><td class="muted small">${b.vendor_id.slice(0, 8)}</td><td><b>${money(b.amount)}</b>
               ${q.awarded_bid === b.id ? ` <span class="tag tag-awarded">채택</span>` : ""}</td>
               <td>${esc(b.message || "-")}</td><td class="muted small">${when(b.created_at)}</td></tr>`).join("")}
           </table>` : `<p class="muted">아직 입찰이 없습니다.</p>`}`}
    </div>`;
  };
  main.innerHTML = `<h2>견적 관리</h2>
    <h3>승인 대기 (${pending.length})</h3>${pending.map(card).join("") || `<p class="muted">대기중인 견적이 없습니다.</p>`}
    <h3 style="margin-top:24px">진행/완료</h3>${others.map(card).join("") || `<p class="muted">없습니다.</p>`}`;
  main.querySelectorAll(".approve-q").forEach(b => b.addEventListener("click", async () => {
    const { error } = await sb.from("quote_requests").update({ status: "open" }).eq("id", b.dataset.id);
    if (error) return toast(error.message, false);
    toast("승인 완료! 업체들에게 전달되었습니다."); render();
  }));
}

// ============================================================
// 부트스트랩
// ============================================================
function parseRoute() { state.route = location.hash.replace("#", "") || "home"; }
window.addEventListener("hashchange", () => { parseRoute(); render(); });
sb.auth.onAuthStateChange(async (_e, session) => {
  state.user = session?.user || null; await loadProfile(); subscribeNotifications(); render();
});
(async function init() {
  if (CONFIG.supabaseUrl.startsWith("YOUR_")) {
    document.body.innerHTML = `<div style="max-width:640px;margin:80px auto;font-family:sans-serif;line-height:1.7">
      <h2>⚙️ 설정 필요</h2><p><code>app.js</code> 상단 CONFIG 의 Supabase 값을 채워주세요.</p></div>`; return;
  }
  parseRoute();
  const { data: { session } } = await sb.auth.getSession();
  state.user = session?.user || null; await loadProfile(); subscribeNotifications(); render();
})();
