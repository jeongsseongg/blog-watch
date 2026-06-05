# 비교견적 플랫폼 (벨로르)

사진 한 장으로 여러 업체의 입찰가를 비교하는 **비교견적 마켓플레이스**입니다.
프론트엔드는 정적 HTML/JS(무료 호스팅), 백엔드는 **Supabase**(무료 티어)로 동작합니다.

## 구현된 기능

- 회원가입/로그인 — **일반회원 / 업체회원 / 관리자** 3개 역할
- 비교견적 요청 (일반회원) → 모든 업체에 **실시간 알림**
- 업체 **입찰** (금액·메시지 제시) → 요청 고객에 **실시간 알림**
- 입찰 **비교 + 채택**으로 견적 진행/마감
- 판매물건 등록·수정·삭제 (업체)
- 커뮤니티 글 작성·수정·삭제 (본인/관리자)
- 관리자 대시보드 (통계 + 최근 비교견적)

---

## 설치 (5단계, 약 10분)

### 1. Supabase 프로젝트 생성
1. https://supabase.com 가입 → **New project** 생성 (무료)
2. 비밀번호/리전(Northeast Asia – Seoul 권장) 설정

### 2. DB 스키마 적용
1. 대시보드 좌측 **SQL Editor** → New query
2. `schema.sql` 전체 내용을 붙여넣고 **RUN**
3. 테이블·트리거·보안정책(RLS)·실시간 설정이 한 번에 적용됩니다

### 2-b. 사진 업로드 기능 추가
`migration_photos.sql` 도 SQL Editor에 붙여넣고 RUN 하세요.
(사진 컬럼 + Storage `photos` 버킷 + 접근정책이 생성됩니다. 최대 10장 업로드 지원)

### 2-c. 승인제 + 후기 + 권한 (v2)
`migration_v2.sql` 도 SQL Editor에 붙여넣고 RUN 하세요.
(업체 승인제, 후기 테이블, 권한 재정의가 적용됩니다.)

### 3. 키 연결
1. 대시보드 **Project Settings → API**
2. `Project URL` 과 `anon public` 키를 복사
3. `app.js` 상단 `CONFIG` 에 붙여넣기
   ```js
   supabaseUrl: "https://xxxx.supabase.co",
   supabaseAnonKey: "eyJhbGciOi...",
   ```
   > anon 키는 공개돼도 됩니다. 데이터 보호는 RLS(schema.sql)가 담당합니다.

### 4. 이메일 인증 설정 (테스트 편의)
- 개발 중에는 **Authentication → Providers → Email** 에서
  *Confirm email* 을 잠시 꺼두면 가입 즉시 로그인 테스트가 됩니다. (운영 시 다시 켜기)

### 5. 실행
- 로컬: 이 폴더에서 `python -m http.server` 후 http://localhost:8000
- 배포: 이 폴더를 **GitHub Pages / Netlify / Cloudflare Pages** 에 올리면 끝 (무료)

---

## 관리자 계정 지정

관리자는 보안상 가입 폼에 없습니다. 일반 가입 후 SQL Editor에서:

```sql
update public.profiles set role = 'admin'
where id = (select id from auth.users where email = '관리자이메일@example.com');
```

## 업체 회원

가입 시 "업체회원"을 선택하면 `role='vendor'` 로 생성되어
들어온 견적 조회·입찰·판매물건 관리 메뉴가 열립니다.

---

## 구글 / 카카오 로그인 설정

로그인 화면에 버튼은 이미 있습니다. 작동하려면 각 제공자 설정이 필요해요.

**구글:**
1. https://console.cloud.google.com → OAuth 동의화면 + OAuth 클라이언트(웹) 생성
2. 승인된 리디렉션 URI 에 `https://<프로젝트>.supabase.co/auth/v1/callback` 추가
3. 발급된 Client ID/Secret 을 Supabase **Authentication → Providers → Google** 에 입력 후 Enable

**카카오:**
1. https://developers.kakao.com → 애플리케이션 추가
2. 카카오 로그인 활성화 + Redirect URI 에 `https://<프로젝트>.supabase.co/auth/v1/callback` 추가
3. REST API 키/Client Secret 을 Supabase **Authentication → Providers → Kakao** 에 입력 후 Enable

> 두 경우 모두 Supabase **Authentication → URL Configuration** 의 Site URL 에
> 배포 주소(예: `https://jeongsseongg.github.io/blog-watch/platform/`)를 넣어주세요.

## 역할별 권한 정리

| | 일반회원 | 업체회원(승인 후) | 관리자 |
|---|---|---|---|
| 후기/판매/커뮤니티 **조회** | O | O | O |
| 비교견적 **요청** | O | - | - |
| 들어온 견적 보기·**입찰** | - | O | O |
| 판매시계·후기·커뮤니티 **수정** | - | - | O |
| 업체 **승인** | - | - | O |

## 오토픽스코리아로 복제하기

1. 이 `platform/` 폴더를 `autofixkorea` 저장소에 복사
2. `app.js` 의 `CONFIG` 만 교체:
   ```js
   brand: "오토픽스코리아",
   tagline: "자동차 정비 비교견적 플랫폼",
   itemLabel: "차량 정보",
   ```
3. `app.js` 의 비교견적 폼 placeholder(품목명 등)를 자동차 문구로 수정
4. **별도 Supabase 프로젝트**를 새로 만들어 키 연결 (데이터 분리)

스키마(schema.sql)는 업종 무관하게 그대로 재사용됩니다.

---

## 비용

| 항목 | 무료 한도 | 초과 시 |
|---|---|---|
| Supabase | DB 500MB, 월 활성유저 5만, 실시간 200동접 | Pro $25/월 |
| 정적 호스팅 | Cloudflare Pages/Netlify 무료 | - |

초기 운영은 **사실상 무료**, 트래픽이 커지면 그때 Pro로 전환하면 됩니다.

## 다음 단계 (미구현 / 확장 후보)

- 이미지 **업로드** (현재는 URL 입력 → Supabase Storage 연동 예정)
- 카카오/구글 소셜 로그인
- 입찰 마감 시간·자동 마감
- 이메일/카카오 알림톡 연동 (현재는 앱 내 실시간 알림)
