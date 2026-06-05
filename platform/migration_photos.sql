-- ============================================================
-- 사진 업로드 기능 추가 (마이그레이션)
-- 사용법: Supabase > SQL Editor 에 붙여넣고 RUN
-- (schema.sql 을 이미 실행한 상태에서 추가로 실행)
-- ============================================================

-- 1) 사진 여러 장 저장용 컬럼 (URL 배열) -----------------------
alter table public.quote_requests add column if not exists photo_urls text[] not null default '{}';
alter table public.listings       add column if not exists image_urls text[] not null default '{}';

-- 2) 사진 저장용 Storage 버킷 생성 (공개) ---------------------
insert into storage.buckets (id, name, public)
values ('photos', 'photos', true)
on conflict (id) do nothing;

-- 3) 버킷 접근 정책 -------------------------------------------
-- 누구나 읽기 (공개 버킷)
drop policy if exists "photos_read" on storage.objects;
create policy "photos_read" on storage.objects
  for select using (bucket_id = 'photos');

-- 로그인 사용자만 업로드
drop policy if exists "photos_upload" on storage.objects;
create policy "photos_upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'photos');

-- 본인이 올린 파일만 삭제
drop policy if exists "photos_delete" on storage.objects;
create policy "photos_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'photos' and owner = auth.uid());
