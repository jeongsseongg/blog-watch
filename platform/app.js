/* ============================================================
 * 비교견적 플랫폼 - 프론트엔드 로직 (Vanilla JS + Supabase v2)
 * ------------------------------------------------------------
 * 다른 브랜드(예: 오토픽스코리아)로 복제할 때는 아래 CONFIG 만
 * 바꾸면 됩니다. Supabase 프로젝트 키는 README 참고.
 * ============================================================ */

const CONFIG = {
  brand: "벨로르",
  tagline: "명품시계 비교견적 · 매입 플랫폼",
  // ↓↓↓ Supabase 대시보드 > Project Settings > API 에서 복사해 넣으세요
  supabaseUrl: "https://iumsnacuxgssnnbckurq.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml1bXNuYWN1eGdzc25uYmNrdXJxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA2NDQ5ODQsImV4cCI6MjA5NjIyMDk4NH0.lwej8g4YCaiYuoQSXczwRp6ez-X26DD5d1ycMkYwpIk",
  // 업종 라벨 (오토픽스코리아면 "차량 정보" 등으로 교체)
  itemLabel: "시계 정보",
  currency: "원",
};

// ---- Supabase 클라이언트 ------------------------------------
const sb = window.supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);

// ---- 전역 상태 ----------------------------------------------
const state = {
  user: null,      // auth user
  profile: null,   // { role, display_name, ... }
  route: "home",
  notifChannel: null,
};

// ---- 유틸 ---------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const el = (html) => { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstChild; };
const money = (n) => (n == null ? "-" : Number(n).toLocaleString("ko-KR") + CONFIG.currency);
const esc = (s) => (s ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const when = (ts) => new Date(ts).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
const toast = (msg, ok = true) => {
  const t = el(`<div class="toast ${ok ? "toast-ok" : "toast-err"}">${esc(msg)}</div>`);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
};
const role = () => state.profile?.role || "guest";

// 사진 업로드 (최대 max장) → 공개 URL 배열 반환
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

// 사진 갤러리 HTML
const gallery = (urls) => (urls && urls.length)
  ? `<div class="gallery">${urls.map(u => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="" loading="lazy"></a>`).join("")}</div>`
  : "";

// 파일 입력 + 미리보기 연결 (최대 max장)
function wirePhotoInput(inputId, previewId, max = 10) {
  const input = $("#" + inputId), prev = $("#" + previewId);
  if (!input) return;
  input.addEventListener("change", () => {
    const files = Array.from(input.files).slice(0, max);
    if (input.files.length > max) toast(`사진은 최대 ${max}장까지예요. 앞 ${max}장만 올립니다.`, false);
    prev.innerHTML = files.map(f => `<img src="${URL.createObjectURL(f)}" alt="">`).join("");
  });
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
  toast("가입 완료! 로그인해 주세요.");
  location.hash = "#login";
}

async function signIn(email, password) {
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) return toast(error.message, false);
  toast("로그인되었습니다.");
  location.hash = "#home";
}

async function signOut() {
  await sb.auth.signOut();
  state.user = null; state.profile = null;
  location.hash = "#home";
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
  if (!state.user) { $("#notif-badge").textContent = ""; return; }
  const { count } = await sb.from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("user_id", state.user.id).eq("is_read", false);
  const badge = $("#notif-badge");
  badge.textContent = count ? String(count) : "";
  badge.style.display = count ? "inline-flex" : "none";
}

function subscribeNotifications() {
  if (state.notifChannel) sb.removeChannel(state.notifChannel);
  if (!state.user) return;
  state.notifChannel = sb.channel("notif:" + state.user.id)
    .on("postgres_changes",
      { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${state.user.id}` },
      (payload) => {
        toast("🔔 " + (payload.new.title || "새 알림"));
        refreshNotifBadge();
        if (state.route === "notifications") render();
      })
    .subscribe();
}

// ============================================================
// 렌더링 (라우터)
// ============================================================
function navLinks() {
  const r = role();
  const links = [["home", "홈"], ["community", "커뮤니티"]];
  if (r === "customer") links.push(["my-quotes", "내 비교견적"], ["new-quote", "견적 요청"]);
  if (r === "vendor") links.push(["vendor-quotes", "들어온 견적"], ["my-listings", "내 판매물건"]);
  if (r === "admin") links.push(["admin", "관리자"]);
  return links.map(([h, t]) =>
    `<a href="#${h}" class="${state.route === h ? "active" : ""}">${t}</a>`).join("");
}

function renderNav() {
  const r = role();
  const authArea = state.user
    ? `<button id="bell" class="bell" title="알림">🔔<span id="notif-badge" class="badge"></span></button>
       <span class="who">${esc(state.profile?.display_name || "")} <em>(${r})</em></span>
       <button id="logout" class="btn-ghost">로그아웃</button>`
    : `<a href="#login" class="btn-ghost">로그인</a><a href="#signup" class="btn">회원가입</a>`;
  $("#nav").innerHTML =
    `<a href="#home" class="brand">${esc(CONFIG.brand)}</a>
     <nav class="links">${navLinks()}</nav>
     <div class="auth">${authArea}</div>`;
  $("#logout")?.addEventListener("click", signOut);
  $("#bell")?.addEventListener("click", () => location.hash = "#notifications");
  refreshNotifBadge();
}

async function render() {
  renderNav();
  const main = $("#view");
  main.innerHTML = `<div class="loading">불러오는 중…</div>`;
  const r = state.route;
  try {
    if (r === "home") return viewHome(main);
    if (r === "login") return viewLogin(main);
    if (r === "signup") return viewSignup(main);
    if (r === "community") return viewCommunity(main);
    if (r === "notifications") return viewNotifications(main);
    if (!state.user) { main.innerHTML = needLogin(); return; }
    if (r === "new-quote") return viewNewQuote(main);
    if (r === "my-quotes") return viewMyQuotes(main);
    if (r === "vendor-quotes") return viewVendorQuotes(main);
    if (r === "my-listings") return viewMyListings(main);
    if (r === "admin") return viewAdmin(main);
    viewHome(main);
  } catch (e) {
    main.innerHTML = `<div class="card err">오류: ${esc(e.message)}</div>`;
  }
}

const needLogin = () => `<div class="card">이 메뉴는 <a href="#login">로그인</a> 후 이용할 수 있습니다.</div>`;

// ============================================================
// 화면: 홈
// ============================================================
async function viewHome(main) {
  const { data: listings } = await sb.from("listings")
    .select("*").eq("status", "on_sale").order("created_at", { ascending: false }).limit(8);
  main.innerHTML = `
    <section class="hero">
      <h1>${esc(CONFIG.brand)}</h1>
      <p>${esc(CONFIG.tagline)}</p>
      ${role() === "customer" || role() === "guest"
        ? `<a href="#${state.user ? "new-quote" : "signup"}" class="btn btn-lg">지금 비교견적 받기</a>` : ""}
    </section>
    <h2>판매중인 물건</h2>
    <div class="grid">${
      (listings || []).map(l => `
        <div class="card listing">
          ${(l.image_urls?.[0] || l.image_url) ? `<img src="${esc(l.image_urls?.[0] || l.image_url)}" alt="">` : `<div class="noimg">이미지 없음</div>`}
          <h3>${esc(l.title)}</h3>
          <p class="price">${money(l.price)}</p>
          <p class="muted">${esc((l.description || "").slice(0, 60))}</p>
        </div>`).join("") || `<p class="muted">등록된 물건이 없습니다.</p>`
    }</div>`;
}

// ============================================================
// 화면: 로그인 / 회원가입
// ============================================================
function viewLogin(main) {
  main.innerHTML = `
    <div class="card form-card">
      <h2>로그인</h2>
      <label>이메일<input id="email" type="email" autocomplete="email"></label>
      <label>비밀번호<input id="pw" type="password" autocomplete="current-password"></label>
      <button id="do-login" class="btn btn-lg">로그인</button>
      <p class="muted">계정이 없으신가요? <a href="#signup">회원가입</a></p>
    </div>`;
  $("#do-login").addEventListener("click", () => signIn($("#email").value.trim(), $("#pw").value));
}

function viewSignup(main) {
  main.innerHTML = `
    <div class="card form-card">
      <h2>회원가입</h2>
      <label>가입 유형
        <select id="role">
          <option value="customer">일반회원 (비교견적 요청)</option>
          <option value="vendor">업체회원 (입찰 참여)</option>
        </select>
      </label>
      <label>이름/닉네임<input id="name"></label>
      <label class="vendor-only" style="display:none">업체 상호<input id="company"></label>
      <label>이메일<input id="email" type="email"></label>
      <label>비밀번호 (6자 이상)<input id="pw" type="password"></label>
      <button id="do-signup" class="btn btn-lg">가입하기</button>
      <p class="muted">이미 계정이 있으신가요? <a href="#login">로그인</a></p>
      <p class="muted small">※ 관리자 계정은 가입 후 DB에서 role을 admin으로 변경합니다 (README 참고).</p>
    </div>`;
  $("#role").addEventListener("change", e => {
    $(".vendor-only").style.display = e.target.value === "vendor" ? "block" : "none";
  });
  $("#do-signup").addEventListener("click", () =>
    signUp($("#email").value.trim(), $("#pw").value, $("#name").value.trim(),
           $("#role").value, $("#company").value.trim()));
}

// ============================================================
// 화면: 비교견적 요청 (고객)
// ============================================================
function viewNewQuote(main) {
  main.innerHTML = `
    <div class="card form-card">
      <h2>비교견적 요청</h2>
      <p class="muted">요청을 등록하면 모든 업체에게 알림이 가고, 업체들이 입찰합니다.</p>
      <label>품목명 *<input id="item_name" placeholder="예: 롤렉스 서브마리너 126610LN"></label>
      <label>브랜드<input id="item_brand" placeholder="예: 롤렉스"></label>
      <label>상세 설명<textarea id="item_detail" rows="4" placeholder="상태, 구성품, 구매시기 등"></textarea></label>
      <label>사진 (최대 10장)<input id="photos" type="file" accept="image/*" multiple></label>
      <div id="preview" class="preview"></div>
      <button id="submit" class="btn btn-lg">견적 요청 등록</button>
    </div>`;
  wirePhotoInput("photos", "preview", 10);
  $("#submit").addEventListener("click", async () => {
    const item_name = $("#item_name").value.trim();
    if (!item_name) return toast("품목명을 입력하세요.", false);
    const btn = $("#submit"); btn.disabled = true; btn.textContent = "사진 올리는 중…";
    const photo_urls = await uploadPhotos($("#photos").files, 10);
    const { error } = await sb.from("quote_requests").insert({
      customer_id: state.user.id,
      item_name,
      item_brand: $("#item_brand").value.trim() || null,
      item_detail: $("#item_detail").value.trim() || null,
      photo_urls,
      photo_url: photo_urls[0] || null,
    });
    btn.disabled = false; btn.textContent = "견적 요청 등록";
    if (error) return toast(error.message, false);
    toast("견적 요청이 등록되었습니다.");
    location.hash = "#my-quotes";
  });
}

// ============================================================
// 화면: 내 비교견적 + 받은 입찰 비교 (고객)
// ============================================================
async function viewMyQuotes(main) {
  const { data: quotes } = await sb.from("quote_requests")
    .select("*").eq("customer_id", state.user.id).order("created_at", { ascending: false });
  if (!quotes?.length) { main.innerHTML = `<div class="card">아직 요청한 비교견적이 없습니다. <a href="#new-quote">요청하기</a></div>`; return; }

  // 각 요청별 입찰 로드
  const ids = quotes.map(q => q.id);
  const { data: bids } = await sb.from("bids").select("*").in("quote_request_id", ids).order("amount", { ascending: false });
  const byQuote = {};
  (bids || []).forEach(b => (byQuote[b.quote_request_id] ||= []).push(b));

  main.innerHTML = `<h2>내 비교견적</h2>` + quotes.map(q => {
    const list = byQuote[q.id] || [];
    const best = list[0];
    return `
    <div class="card">
      <div class="row between">
        <h3>${esc(q.item_name)} <span class="tag tag-${q.status}">${q.status}</span></h3>
        <span class="muted">${when(q.created_at)}</span>
      </div>
      ${q.item_detail ? `<p class="muted">${esc(q.item_detail)}</p>` : ""}
      <h4>받은 입찰 ${list.length}건 ${best ? `· 최고가 <b>${money(best.amount)}</b>` : ""}</h4>
      ${list.length ? `<table class="bids">
        <tr><th>금액</th><th>메시지</th><th>일시</th><th></th></tr>
        ${list.map(b => `<tr>
          <td><b>${money(b.amount)}</b></td>
          <td>${esc(b.message || "-")}</td>
          <td class="muted">${when(b.created_at)}</td>
          <td>${q.status === "open"
              ? `<button class="btn-sm award" data-q="${q.id}" data-b="${b.id}">이 입찰 채택</button>`
              : (q.awarded_bid === b.id ? `<span class="tag tag-awarded">채택됨</span>` : "")}</td>
        </tr>`).join("")}
      </table>` : `<p class="muted">아직 입찰이 없습니다. 업체 입찰을 기다리는 중…</p>`}
    </div>`;
  }).join("");

  main.querySelectorAll(".award").forEach(btn => btn.addEventListener("click", async () => {
    if (!confirm("이 입찰을 채택하시겠어요? 견적이 마감됩니다.")) return;
    const q = btn.dataset.q, b = btn.dataset.b;
    const { error } = await sb.from("quote_requests").update({ status: "awarded", awarded_bid: b }).eq("id", q);
    if (error) return toast(error.message, false);
    toast("입찰을 채택했습니다.");
    render();
  }));
}

// ============================================================
// 화면: 들어온 비교견적 + 입찰 (업체)
// ============================================================
async function viewVendorQuotes(main) {
  const { data: quotes } = await sb.from("quote_requests")
    .select("*").eq("status", "open").order("created_at", { ascending: false });
  const { data: myBids } = await sb.from("bids").select("*").eq("vendor_id", state.user.id);
  const mine = {}; (myBids || []).forEach(b => mine[b.quote_request_id] = b);

  main.innerHTML = `<h2>들어온 비교견적</h2>` + ((quotes?.length ? quotes : []).map(q => {
    const b = mine[q.id];
    return `
    <div class="card">
      <h3>${esc(q.item_name)} ${q.item_brand ? `<span class="muted">/ ${esc(q.item_brand)}</span>` : ""}</h3>
      ${q.item_detail ? `<p class="muted">${esc(q.item_detail)}</p>` : ""}
      ${gallery(q.photo_urls?.length ? q.photo_urls : (q.photo_url ? [q.photo_url] : []))}
      ${b
        ? `<p class="bidded">내 입찰가: <b>${money(b.amount)}</b> ${b.message ? `· ${esc(b.message)}` : ""}</p>`
        : `<div class="bid-form">
             <input type="number" class="bid-amount" placeholder="입찰 금액 (${CONFIG.currency})" data-q="${q.id}">
             <input type="text" class="bid-msg" placeholder="메시지 (선택)" data-q="${q.id}">
             <button class="btn place-bid" data-q="${q.id}">입찰하기</button>
           </div>`}
    </div>`;
  }).join("") || `<p class="muted">현재 진행중인 비교견적이 없습니다.</p>`);

  main.querySelectorAll(".place-bid").forEach(btn => btn.addEventListener("click", async () => {
    const q = btn.dataset.q;
    const amount = Number($(`.bid-amount[data-q="${q}"]`).value);
    const message = $(`.bid-msg[data-q="${q}"]`).value.trim();
    if (!amount || amount <= 0) return toast("입찰 금액을 입력하세요.", false);
    const { error } = await sb.from("bids").insert({
      quote_request_id: q, vendor_id: state.user.id, amount, message: message || null });
    if (error) return toast(error.message, false);
    toast("입찰이 등록되었습니다.");
    render();
  }));
}

// ============================================================
// 화면: 내 판매물건 CRUD (업체)
// ============================================================
async function viewMyListings(main) {
  const { data: items } = await sb.from("listings")
    .select("*").eq("owner_id", state.user.id).order("created_at", { ascending: false });
  main.innerHTML = `
    <div class="row between"><h2>내 판매물건</h2>
      <button id="add" class="btn">+ 새 물건 등록</button></div>
    <div id="editor"></div>
    <div class="grid">${(items || []).map(l => `
      <div class="card listing">
        ${l.image_url ? `<img src="${esc(l.image_url)}" alt="">` : `<div class="noimg">이미지 없음</div>`}
        <h3>${esc(l.title)}</h3>
        <p class="price">${money(l.price)} <span class="tag tag-${l.status}">${l.status}</span></p>
        <div class="row">
          <button class="btn-sm edit" data-id="${l.id}">수정</button>
          <button class="btn-sm danger del" data-id="${l.id}">삭제</button>
        </div>
      </div>`).join("") || `<p class="muted">등록한 물건이 없습니다.</p>`}</div>`;

  const items_map = {}; (items || []).forEach(i => items_map[i.id] = i);
  const showEditor = (item) => {
    $("#editor").innerHTML = `
      <div class="card form-card">
        <h3>${item ? "물건 수정" : "새 물건 등록"}</h3>
        <label>제목 *<input id="f_title" value="${esc(item?.title || "")}"></label>
        <label>가격<input id="f_price" type="number" value="${item?.price ?? ""}"></label>
        <label>설명<textarea id="f_desc" rows="3">${esc(item?.description || "")}</textarea></label>
        <label>사진 추가 (최대 10장)<input id="f_photos" type="file" accept="image/*" multiple></label>
        <div id="f_preview" class="preview"></div>
        ${(item?.image_urls?.length) ? `<p class="muted small">기존 사진 ${item.image_urls.length}장 유지됨</p>${gallery(item.image_urls)}` : ""}
        <label>상태<select id="f_status">
          ${["on_sale","sold","hidden"].map(s => `<option ${item?.status===s?"selected":""}>${s}</option>`).join("")}
        </select></label>
        <div class="row"><button id="save" class="btn">저장</button>
          <button id="cancel" class="btn-ghost">취소</button></div>
      </div>`;
    wirePhotoInput("f_photos", "f_preview", 10);
    $("#cancel").addEventListener("click", () => $("#editor").innerHTML = "");
    $("#save").addEventListener("click", async () => {
      const save = $("#save"); save.disabled = true; save.textContent = "저장 중…";
      const existing = item?.image_urls || [];
      const newUrls = await uploadPhotos($("#f_photos").files, 10);
      const image_urls = [...existing, ...newUrls].slice(0, 10);
      const payload = {
        owner_id: state.user.id,
        title: $("#f_title").value.trim(),
        price: $("#f_price").value ? Number($("#f_price").value) : null,
        description: $("#f_desc").value.trim() || null,
        image_urls,
        image_url: image_urls[0] || null,
        status: $("#f_status").value,
        updated_at: new Date().toISOString(),
      };
      if (!payload.title) { save.disabled = false; save.textContent = "저장"; return toast("제목을 입력하세요.", false); }
      const res = item
        ? await sb.from("listings").update(payload).eq("id", item.id)
        : await sb.from("listings").insert(payload);
      if (res.error) return toast(res.error.message, false);
      toast("저장되었습니다."); render();
    });
  };

  $("#add").addEventListener("click", () => showEditor(null));
  main.querySelectorAll(".edit").forEach(b => b.addEventListener("click", () => showEditor(items_map[b.dataset.id])));
  main.querySelectorAll(".del").forEach(b => b.addEventListener("click", async () => {
    if (!confirm("삭제하시겠어요?")) return;
    const { error } = await sb.from("listings").delete().eq("id", b.dataset.id);
    if (error) return toast(error.message, false);
    toast("삭제했습니다."); render();
  }));
}

// ============================================================
// 화면: 커뮤니티 (작성/수정/삭제, 모든 회원)
// ============================================================
async function viewCommunity(main) {
  const { data: posts } = await sb.from("community_posts")
    .select("*, profiles(display_name)").order("created_at", { ascending: false });
  const canWrite = !!state.user;
  main.innerHTML = `
    <div class="row between"><h2>커뮤니티</h2>
      ${canWrite ? `<button id="write" class="btn">+ 글쓰기</button>` : ""}</div>
    <div id="post-editor"></div>
    ${(posts || []).map(p => {
      const mine = state.user && (p.author_id === state.user.id);
      const canEdit = mine || role() === "admin";
      return `
      <div class="card post">
        <div class="row between">
          <h3>${esc(p.title)}</h3>
          ${canEdit ? `<div class="row">
            <button class="btn-sm edit-post" data-id="${p.id}">수정</button>
            <button class="btn-sm danger del-post" data-id="${p.id}">삭제</button></div>` : ""}
        </div>
        <p class="muted small">${esc(p.profiles?.display_name || "익명")} · ${when(p.created_at)}</p>
        <p>${esc(p.body || "").replace(/\n/g, "<br>")}</p>
      </div>`;
    }).join("") || `<p class="muted">아직 게시글이 없습니다.</p>`}`;

  const posts_map = {}; (posts || []).forEach(p => posts_map[p.id] = p);
  const showEditor = (post) => {
    if (!state.user) return toast("로그인이 필요합니다.", false);
    $("#post-editor").innerHTML = `
      <div class="card form-card">
        <h3>${post ? "글 수정" : "새 글 작성"}</h3>
        <label>제목 *<input id="p_title" value="${esc(post?.title || "")}"></label>
        <label>내용<textarea id="p_body" rows="5">${esc(post?.body || "")}</textarea></label>
        <div class="row"><button id="p_save" class="btn">저장</button>
          <button id="p_cancel" class="btn-ghost">취소</button></div>
      </div>`;
    $("#p_cancel").addEventListener("click", () => $("#post-editor").innerHTML = "");
    $("#p_save").addEventListener("click", async () => {
      const title = $("#p_title").value.trim();
      const body = $("#p_body").value.trim();
      if (!title) return toast("제목을 입력하세요.", false);
      const res = post
        ? await sb.from("community_posts").update({ title, body, updated_at: new Date().toISOString() }).eq("id", post.id)
        : await sb.from("community_posts").insert({ author_id: state.user.id, title, body });
      if (res.error) return toast(res.error.message, false);
      toast("저장되었습니다."); render();
    });
  };

  $("#write")?.addEventListener("click", () => showEditor(null));
  main.querySelectorAll(".edit-post").forEach(b => b.addEventListener("click", () => showEditor(posts_map[b.dataset.id])));
  main.querySelectorAll(".del-post").forEach(b => b.addEventListener("click", async () => {
    if (!confirm("삭제하시겠어요?")) return;
    const { error } = await sb.from("community_posts").delete().eq("id", b.dataset.id);
    if (error) return toast(error.message, false);
    toast("삭제했습니다."); render();
  }));
}

// ============================================================
// 화면: 알림
// ============================================================
async function viewNotifications(main) {
  if (!state.user) { main.innerHTML = needLogin(); return; }
  const { data: notifs } = await sb.from("notifications")
    .select("*").eq("user_id", state.user.id).order("created_at", { ascending: false }).limit(50);
  main.innerHTML = `<div class="row between"><h2>알림</h2>
    <button id="read-all" class="btn-ghost">모두 읽음</button></div>` +
    ((notifs || []).map(n => `
      <div class="card notif ${n.is_read ? "" : "unread"}">
        <b>${esc(n.title || "")}</b> <span class="muted small">${when(n.created_at)}</span>
        <p>${esc(n.body || "")}</p>
      </div>`).join("") || `<p class="muted">알림이 없습니다.</p>`);

  // 열람 시 자동 읽음 처리
  const unreadIds = (notifs || []).filter(n => !n.is_read).map(n => n.id);
  if (unreadIds.length) {
    await sb.from("notifications").update({ is_read: true }).in("id", unreadIds);
    refreshNotifBadge();
  }
  $("#read-all").addEventListener("click", async () => {
    await sb.from("notifications").update({ is_read: true }).eq("user_id", state.user.id).eq("is_read", false);
    toast("모두 읽음 처리했습니다."); render();
  });
}

// ============================================================
// 화면: 관리자
// ============================================================
async function viewAdmin(main) {
  if (role() !== "admin") { main.innerHTML = `<div class="card err">관리자 전용 메뉴입니다.</div>`; return; }
  const [{ count: users }, { count: quotes }, { count: bids }, { count: posts }] = await Promise.all([
    sb.from("profiles").select("*", { count: "exact", head: true }),
    sb.from("quote_requests").select("*", { count: "exact", head: true }),
    sb.from("bids").select("*", { count: "exact", head: true }),
    sb.from("community_posts").select("*", { count: "exact", head: true }),
  ]);
  const { data: recentQuotes } = await sb.from("quote_requests")
    .select("*, profiles(display_name)").order("created_at", { ascending: false }).limit(20);
  main.innerHTML = `
    <h2>관리자 대시보드</h2>
    <div class="stats">
      <div class="stat"><b>${users ?? 0}</b><span>회원</span></div>
      <div class="stat"><b>${quotes ?? 0}</b><span>비교견적</span></div>
      <div class="stat"><b>${bids ?? 0}</b><span>입찰</span></div>
      <div class="stat"><b>${posts ?? 0}</b><span>게시글</span></div>
    </div>
    <h3>최근 비교견적</h3>
    <table class="bids">
      <tr><th>품목</th><th>요청자</th><th>상태</th><th>일시</th></tr>
      ${(recentQuotes || []).map(q => `<tr>
        <td>${esc(q.item_name)}</td>
        <td>${esc(q.profiles?.display_name || "-")}</td>
        <td><span class="tag tag-${q.status}">${q.status}</span></td>
        <td class="muted">${when(q.created_at)}</td></tr>`).join("")}
    </table>`;
}

// ============================================================
// 부트스트랩
// ============================================================
function parseRoute() { state.route = (location.hash.replace("#", "") || "home"); }
window.addEventListener("hashchange", () => { parseRoute(); render(); });

sb.auth.onAuthStateChange(async (_event, session) => {
  state.user = session?.user || null;
  await loadProfile();
  subscribeNotifications();
  render();
});

(async function init() {
  if (CONFIG.supabaseUrl.startsWith("YOUR_")) {
    document.body.innerHTML = `<div style="max-width:640px;margin:80px auto;font-family:sans-serif;line-height:1.7">
      <h2>⚙️ 설정 필요</h2><p><code>app.js</code> 상단의 <b>CONFIG.supabaseUrl</b> / <b>supabaseAnonKey</b> 를
      Supabase 프로젝트 값으로 채워주세요. (README 참고)</p></div>`;
    return;
  }
  parseRoute();
  const { data: { session } } = await sb.auth.getSession();
  state.user = session?.user || null;
  await loadProfile();
  subscribeNotifications();
  render();
})();
