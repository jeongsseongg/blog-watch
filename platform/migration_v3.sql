-- ============================================================
-- v3: 견적 승인(중재) + 카테고리(판매/커뮤니티)
-- 사용법: Supabase > SQL Editor 에 붙여넣고 RUN
-- ============================================================

-- 1) 카테고리 컬럼 -------------------------------------------
alter table public.listings        add column if not exists category text not null default '벨로르판매';
alter table public.community_posts add column if not exists category text not null default '자유게시판';

-- 2) 비교견적: 기본 상태를 '대기(pending)'로 ------------------
alter table public.quote_requests alter column status set default 'pending';

-- 3) 새 견적(대기) → 관리자에게만 알림 -----------------------
create or replace function public.notify_on_quote()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.notifications (user_id, type, title, body, link)
  select p.id, 'new_quote', '새 비교견적 (승인 대기)', new.item_name, new.id::text
  from public.profiles p
  where p.role = 'admin';
  return new;
end $$;

-- 4) 승인되어 open 되면 → 승인된 업체에게 알림 ----------------
create or replace function public.notify_quote_open()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'open' and coalesce(old.status, '') <> 'open' then
    insert into public.notifications (user_id, type, title, body, link)
    select p.id, 'quote_open', '새 비교견적 문의', new.item_name, new.id::text
    from public.profiles p
    where p.role = 'vendor' and p.approved;
  end if;
  return new;
end $$;

drop trigger if exists trg_notify_quote_open on public.quote_requests;
create trigger trg_notify_quote_open
  after update on public.quote_requests
  for each row execute function public.notify_quote_open();
