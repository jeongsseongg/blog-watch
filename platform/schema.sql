-- ============================================================
-- 비교견적 플랫폼 데이터베이스 스키마 (Supabase / PostgreSQL)
-- ------------------------------------------------------------
-- 사용법: Supabase 대시보드 > SQL Editor 에 전체 붙여넣고 RUN
-- 이 스크립트는 여러 번 실행해도 안전하도록 작성했습니다.
-- ============================================================

-- 1) 역할 타입 ------------------------------------------------
do $$ begin
  create type user_role as enum ('customer', 'vendor', 'admin');
exception when duplicate_object then null; end $$;

-- 2) 프로필 (auth.users 와 1:1) -------------------------------
create table if not exists public.profiles (
  id           uuid primary key references auth.users on delete cascade,
  role         user_role not null default 'customer',
  display_name text,
  phone        text,
  company_name text,                 -- 업체 회원용 상호
  created_at   timestamptz not null default now()
);

-- 3) 판매중인 물건 -------------------------------------------
create table if not exists public.listings (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id) on delete cascade,
  title       text not null,
  description text,
  price       numeric,
  status      text not null default 'on_sale',  -- on_sale | sold | hidden
  image_url   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 4) 비교견적 문의 -------------------------------------------
create table if not exists public.quote_requests (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.profiles(id) on delete cascade,
  item_name   text not null,
  item_brand  text,
  item_detail text,
  photo_url   text,
  status      text not null default 'open',      -- open | closed | awarded
  awarded_bid uuid,                               -- 채택된 입찰 id
  created_at  timestamptz not null default now()
);

-- 5) 입찰 (업체가 비교견적에 금액 제시) ----------------------
create table if not exists public.bids (
  id               uuid primary key default gen_random_uuid(),
  quote_request_id uuid not null references public.quote_requests(id) on delete cascade,
  vendor_id        uuid not null references public.profiles(id) on delete cascade,
  amount           numeric not null,
  message          text,
  created_at       timestamptz not null default now(),
  unique (quote_request_id, vendor_id)            -- 한 업체당 한 건만
);

-- 6) 커뮤니티 게시글 -----------------------------------------
create table if not exists public.community_posts (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid references public.profiles(id) on delete set null,
  title      text not null,
  body       text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 7) 알림 -----------------------------------------------------
create table if not exists public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  type       text,                                -- new_quote | new_bid | awarded
  title      text,
  body       text,
  link       text,
  is_read    boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============================================================
-- 함수 / 트리거
-- ============================================================

-- 가입 시 프로필 자동 생성 (기본 역할: customer)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, role, display_name, company_name)
  values (
    new.id,
    coalesce((new.raw_user_meta_data->>'role')::user_role, 'customer'),
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'company_name'
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 관리자 여부 (RLS 재귀 방지용 security definer)
create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- 새 비교견적 문의 → 모든 업체/관리자에게 알림
create or replace function public.notify_on_quote()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, type, title, body, link)
  select p.id, 'new_quote', '새 비교견적 문의', new.item_name, new.id::text
  from public.profiles p
  where p.role in ('vendor', 'admin');
  return new;
end $$;

drop trigger if exists trg_notify_quote on public.quote_requests;
create trigger trg_notify_quote
  after insert on public.quote_requests
  for each row execute function public.notify_on_quote();

-- 새 입찰 → 문의한 고객에게 알림
create or replace function public.notify_on_bid()
returns trigger language plpgsql security definer set search_path = public as $$
declare cust uuid;
begin
  select customer_id into cust from public.quote_requests where id = new.quote_request_id;
  insert into public.notifications (user_id, type, title, body, link)
  values (cust, 'new_bid', '새 입찰 도착',
          to_char(new.amount, 'FM999,999,999') || '원 입찰이 들어왔습니다', new.quote_request_id::text);
  return new;
end $$;

drop trigger if exists trg_notify_bid on public.bids;
create trigger trg_notify_bid
  after insert on public.bids
  for each row execute function public.notify_on_bid();

-- ============================================================
-- Row Level Security (RLS)
-- ============================================================
alter table public.profiles        enable row level security;
alter table public.listings        enable row level security;
alter table public.quote_requests  enable row level security;
alter table public.bids            enable row level security;
alter table public.community_posts enable row level security;
alter table public.notifications   enable row level security;

-- profiles: 본인 + 관리자 조회, 본인 수정
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select using (id = auth.uid() or public.is_admin());
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update using (id = auth.uid());

-- listings: 누구나 조회 / 본인(또는 관리자) 작성·수정·삭제
drop policy if exists listings_select on public.listings;
create policy listings_select on public.listings for select using (true);
drop policy if exists listings_insert on public.listings;
create policy listings_insert on public.listings
  for insert with check (owner_id = auth.uid());
drop policy if exists listings_update on public.listings;
create policy listings_update on public.listings
  for update using (owner_id = auth.uid() or public.is_admin());
drop policy if exists listings_delete on public.listings;
create policy listings_delete on public.listings
  for delete using (owner_id = auth.uid() or public.is_admin());

-- quote_requests: 고객 본인이 작성 / 본인·업체·관리자 조회 / 본인·관리자 수정
drop policy if exists quotes_insert on public.quote_requests;
create policy quotes_insert on public.quote_requests
  for insert with check (customer_id = auth.uid());
drop policy if exists quotes_select on public.quote_requests;
create policy quotes_select on public.quote_requests
  for select using (
    customer_id = auth.uid()
    or public.is_admin()
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'vendor')
  );
drop policy if exists quotes_update on public.quote_requests;
create policy quotes_update on public.quote_requests
  for update using (customer_id = auth.uid() or public.is_admin());

-- bids: 업체가 작성 / 입찰자·해당문의 고객·관리자 조회
drop policy if exists bids_insert on public.bids;
create policy bids_insert on public.bids
  for insert with check (
    vendor_id = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('vendor','admin'))
  );
drop policy if exists bids_select on public.bids;
create policy bids_select on public.bids
  for select using (
    vendor_id = auth.uid()
    or public.is_admin()
    or exists (select 1 from public.quote_requests q
               where q.id = quote_request_id and q.customer_id = auth.uid())
  );
drop policy if exists bids_update on public.bids;
create policy bids_update on public.bids
  for update using (vendor_id = auth.uid());

-- community_posts: 누구나 조회 / 로그인 작성 / 본인·관리자 수정·삭제
drop policy if exists posts_select on public.community_posts;
create policy posts_select on public.community_posts for select using (true);
drop policy if exists posts_insert on public.community_posts;
create policy posts_insert on public.community_posts
  for insert with check (author_id = auth.uid());
drop policy if exists posts_update on public.community_posts;
create policy posts_update on public.community_posts
  for update using (author_id = auth.uid() or public.is_admin());
drop policy if exists posts_delete on public.community_posts;
create policy posts_delete on public.community_posts
  for delete using (author_id = auth.uid() or public.is_admin());

-- notifications: 본인 것만 조회·수정
drop policy if exists notif_select on public.notifications;
create policy notif_select on public.notifications
  for select using (user_id = auth.uid());
drop policy if exists notif_update on public.notifications;
create policy notif_update on public.notifications
  for update using (user_id = auth.uid());

-- ============================================================
-- 실시간(Realtime) 발행 대상 등록
-- ============================================================
alter publication supabase_realtime add table public.notifications;
alter publication supabase_realtime add table public.bids;
alter publication supabase_realtime add table public.quote_requests;
