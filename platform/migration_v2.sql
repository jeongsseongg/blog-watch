-- ============================================================
-- v2: 업체 승인제 + 후기 + 권한 재정의
-- 사용법: Supabase > SQL Editor 에 붙여넣고 RUN
-- (schema.sql, migration_photos.sql 실행 후 추가 실행)
-- ============================================================

-- 1) 승인 컬럼 (업체 승인제) ----------------------------------
alter table public.profiles add column if not exists approved boolean not null default false;
update public.profiles set approved = true where role in ('customer', 'admin');

-- 2) 가입 트리거: 고객/관리자 자동승인, 업체는 '대기' --------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare r user_role;
begin
  r := coalesce((new.raw_user_meta_data->>'role')::user_role, 'customer');
  insert into public.profiles (id, role, display_name, company_name, approved)
  values (
    new.id, r,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'company_name',
    (r <> 'vendor')               -- 업체만 false(대기)
  )
  on conflict (id) do nothing;
  return new;
end $$;

-- 3) 승인된 업체 여부 -----------------------------------------
create or replace function public.is_approved_vendor()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles
                 where id = auth.uid() and role = 'vendor' and approved);
$$;

-- 4) 후기 테이블 ----------------------------------------------
create table if not exists public.reviews (
  id          uuid primary key default gen_random_uuid(),
  author_name text,
  rating      int check (rating between 1 and 5),
  title       text not null,
  body        text,
  image_urls  text[] not null default '{}',
  created_at  timestamptz not null default now()
);
alter table public.reviews enable row level security;
drop policy if exists reviews_select on public.reviews;
create policy reviews_select on public.reviews for select using (true);
drop policy if exists reviews_admin on public.reviews;
create policy reviews_admin on public.reviews for all
  using (public.is_admin()) with check (public.is_admin());

-- 5) 권한 재정의 ----------------------------------------------
-- 판매중 시계: 관리자만 작성/수정/삭제 (조회는 누구나)
drop policy if exists listings_insert on public.listings;
create policy listings_insert on public.listings for insert with check (public.is_admin());
drop policy if exists listings_update on public.listings;
create policy listings_update on public.listings for update using (public.is_admin());
drop policy if exists listings_delete on public.listings;
create policy listings_delete on public.listings for delete using (public.is_admin());

-- 커뮤니티: 관리자만 작성/수정/삭제 (조회는 누구나)
drop policy if exists posts_insert on public.community_posts;
create policy posts_insert on public.community_posts for insert with check (public.is_admin());
drop policy if exists posts_update on public.community_posts;
create policy posts_update on public.community_posts for update using (public.is_admin());
drop policy if exists posts_delete on public.community_posts;
create policy posts_delete on public.community_posts for delete using (public.is_admin());

-- 비교견적: 승인된 업체만 열람 (+ 고객 본인 / 관리자)
drop policy if exists quotes_select on public.quote_requests;
create policy quotes_select on public.quote_requests for select using (
  customer_id = auth.uid() or public.is_admin() or public.is_approved_vendor()
);

-- 입찰: 승인된 업체만 가능
drop policy if exists bids_insert on public.bids;
create policy bids_insert on public.bids for insert with check (
  vendor_id = auth.uid() and (public.is_approved_vendor() or public.is_admin())
);

-- 관리자는 회원 승인(프로필 수정) 가능
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update using (public.is_admin());

-- 6) 새 견적 알림: 승인된 업체 + 관리자에게만 ----------------
create or replace function public.notify_on_quote()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, type, title, body, link)
  select p.id, 'new_quote', '새 비교견적 문의', new.item_name, new.id::text
  from public.profiles p
  where p.role = 'admin' or (p.role = 'vendor' and p.approved);
  return new;
end $$;
