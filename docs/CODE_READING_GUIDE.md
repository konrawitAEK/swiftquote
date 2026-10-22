# แนวทางการอ่านโค้ด SwiftQuote

คู่มือนี้สำหรับคนที่เพิ่งเปิดโปรเจกต์ครั้งแรก หรือคุ้นภาษาหนึ่งแล้วอยากอ่านอีกภาษาให้เข้าใจเร็ว
ทุกส่วนใช้ **ตัวอย่างเดียวกัน** คือ "WO อนุมัติใบเสนอราคา" (`POST /api/v1/quotes/{id}/approve`)
จะได้เทียบได้ว่าเรื่องเดียวกันอยู่ตรงไหนในแต่ละภาษา

> เลขบรรทัดในลิงก์อาจเลื่อนเมื่อโค้ดเปลี่ยน ให้ยึด **ชื่อไฟล์และชื่อฟังก์ชัน** เป็นหลัก

---

## 0. ก่อนเปิดโค้ด: เริ่มจาก contract

ทุก backend และทุก frontend ทำตามไฟล์เดียวกันคือ [`contracts/openapi.yaml`](../contracts/openapi.yaml)
ถ้าอยากรู้ว่า endpoint ไหนรับอะไร ตอบอะไร และ error มีอะไรบ้าง **อ่านที่นี่ก่อนเสมอ** แล้วค่อยไปดูว่าแต่ละภาษาทำตามอย่างไร

ลำดับการตรวจสอบเหมือนกันทุก backend (ถ้าเจอข้อแรกที่ไม่ผ่าน จะตอบ error นั้นเลย):

| ลำดับ | ตรวจอะไร | ได้อะไร |
|---|---|---|
| 1 | token ถูกต้องและบัญชียัง active | 401 `UNAUTHORIZED` |
| 2 | body เป็น JSON ที่อ่านได้ | 400 `VALIDATION_ERROR` |
| 3 | role ทำ action นี้ได้ | 403 `FORBIDDEN` |
| 4 | role นี้มองเห็นข้อมูลนั้น (id ผิดรูปแบบก็นับเป็นหาไม่เจอ) | 404 `NOT_FOUND` |
| 5 | เนื้อหาใน body ถูกต้อง | 400 `VALIDATION_ERROR` |
| 6 | สถานะตอนนี้ทำ action นี้ได้ | 409 `CONFLICT` |

**ทุก backend มี 4 ชั้นเหมือนกัน** อ่านจากบนลงล่างตามทางที่ request วิ่งผ่าน:

```
HTTP request
  → route        จับคู่ URL กับ handler และบังคับให้ login
  → handler      แปลง JSON ↔ object, เรียก service, แปลงผลกลับเป็น JSON
  → service      กฎธุรกิจทั้งหมด: role, การมองเห็น, validation, สถานะ   ← อ่านตรงนี้ให้ละเอียดที่สุด
  → repository   SQL ล้วน ไม่มีกฎธุรกิจ
  → Postgres
```

| ชั้น | Go | Spring (Java) | Node (TypeScript) |
|---|---|---|---|
| จุดเริ่มโปรแกรม (ประกอบทุกชิ้นเข้าด้วยกัน) | `cmd/server/main.go` | `SpringBootServiceApplication.java` (Spring ประกอบให้) | `src/server.ts` |
| route | `internal/delivery/http/router.go` | `@PostMapping` ใน `web/rest/ApiController.java` | ตาราง `actions` และ `app.route` ใน `src/app.ts` |
| handler / DTO | `delivery/http/handlers.go`, `dto.go` | `ApiController.java`, `Dtos.java` | `src/app.ts`, `src/views.ts` |
| หาว่าใครเรียก (actor) | `requireAuth` ใน `handlers.go` | `web/rest/ActorResolver.java` | `requireAuth` ใน `src/app.ts` |
| service | `internal/quote/service.go` ฯลฯ | `service/QuoteService.java` ฯลฯ | `src/services.ts`, `src/admin.ts` |
| repository (SQL) | `internal/storage/postgres/*.go` | `repository/*Repository.java` | `src/repository.ts` |
| แปลง error เป็น JSON | `delivery/http/errors.go` | `web/rest/ApiExceptionHandler.java` | `setErrorHandler` ใน `src/app.ts` |
| สเปกที่อ่านง่ายที่สุด (เทสต์) | `delivery/http/router_test.go` | `ApiIntegrationTest.java` | `src/app.test.ts` |

> **เคล็ดลับ:** ถ้าไม่แน่ใจว่ากฎข้อไหนทำงานอย่างไร **ให้อ่านเทสต์ก่อนโค้ด** เทสต์บอกว่า input นี้ต้องได้ผลอะไร ชัดกว่าการไล่ if

---

## 1. Go (Fiber + pgx): `backend/go-service`

Go เป็นตัว **ต้นแบบ (reference)** ถ้า backend อื่นทำไม่ตรงกับ Go ถือว่า Go ถูก

### โครงสร้าง
```
cmd/server/main.go           จุดเริ่ม: อ่าน config, ต่อ DB, สร้าง service ทุกตัว, เปิด router
internal/
  config/                    อ่านค่าจาก env (DB, JWT_SECRET, CORS)
  domain/                    type กลางที่ทุกส่วนใช้: Quote, Actor, Role, error มาตรฐาน
  auth/ quote/ admin/        1 package = 1 เรื่องธุรกิจ (service + interface ของ repository ที่ต้องการ)
  catalog/ client/ dashboard/
  delivery/http/             ทุกอย่างที่เกี่ยวกับ HTTP: router, handler, DTO, แปลง error
  storage/postgres/          ทำ interface ของ repository จริงด้วย SQL
```

### ธรรมเนียมของ Go ที่ต้องรู้ก่อนอ่าน
- **error เป็นค่าธรรมดา ไม่ใช่ exception:** ทุกฟังก์ชันที่พังได้คืนค่า `(ผลลัพธ์, error)` แล้วเช็ก `if err != nil { return ..., err }` ทันที เส้นทางปกติจึงอ่านได้ตรงลงมาเป็นเส้นเดียว
- **interface ประกาศฝั่งคนใช้:** `quote.Repository` อยู่ใน `internal/quote/` ไม่ใช่ใน `storage/` ตัว `storage/postgres` แค่มี method ตรงตาม interface นั้น (Go ไม่ต้องเขียน `implements`)
- **`ctx context.Context` เป็นพารามิเตอร์แรกเสมอ:** ใช้ส่งต่อการยกเลิกและ timeout ไปถึง DB
- **pointer `*string` ในฟิลด์ input:** หมายถึง "ไม่ได้ส่งมา" (nil) ต่างจาก "ส่งค่าว่างมา" (`""`) ใช้แยก error `X is required` ออกจาก `X must not be empty`
- **struct tag** เช่น `` `json:"quoteNumber"` `` บอกชื่อ field ใน JSON
- **error มาตรฐานอยู่ใน `domain/errors.go`:** `ErrRoleForbidden`, `NotFound(...)`, `Conflict(...)`, `Invalid(...)` ส่วน `errors.go` ใน `delivery/http` เป็นตัวแปลงเป็น status code

### ไล่ตัวอย่าง: WO อนุมัติ
1. **route:** [`router.go`](../backend/go-service/internal/delivery/http/router.go) มีบรรทัด
   `api.Post("/quotes/:id/approve", h.requireAuth, h.quoteAction(approveQuote))`
   ตัว `requireAuth` ตรวจ token และโหลด actor (role, active) จาก DB ใหม่ทุก request
2. **handler:** `quoteAction` ใน [`handlers.go`](../backend/go-service/internal/delivery/http/handlers.go) อ่าน `{"comment"}` ที่ไม่บังคับ แล้วเรียก `approveQuote` ซึ่งต่อไปที่ `quote.Service.Approve` ผลลัพธ์ถูกแปลงด้วย `toQuoteDetail` (ใน `dto.go`)
3. **service:** `Approve` ใน [`quote/service.go`](../backend/go-service/internal/quote/service.go)
   ```go
   if a.Role != domain.RoleWO { return ..., domain.ErrRoleForbidden }   // 403
   q, err := s.visible(ctx, a, id)                                       // 404 ถ้า WO นี้มองไม่เห็น
   return s.transition(ctx, a, q, "approve",
       []domain.QuoteStatus{domain.StatusPendingApproval}, domain.StatusApproved, ...) // 409 ถ้าสถานะไม่ใช่
   ```
   `visible` คือกฎว่าใครเห็นใบไหน ส่วน `transition` เป็นตัวเปลี่ยนสถานะกลางที่ submit, approve, return, send และ reject ใช้ร่วมกัน
4. **repository:** `Transition` ใน [`storage/postgres/quotes.go`](../backend/go-service/internal/storage/postgres/quotes.go)
   ```sql
   UPDATE quotes SET status = $2 WHERE id = $1 AND status = ANY($3)
   ```
   เงื่อนไขสถานะอยู่ใน `WHERE` เลย ถ้ามีคนเปลี่ยนสถานะไปก่อน จะอัปเดตได้ 0 แถว แล้ว service ตอบ 409 ทำแบบนี้เพื่อกันกรณีสองคนกดพร้อมกัน และบันทึก `quote_events` (ประวัติ) ใน transaction เดียวกัน

### เครื่องมือช่วยอ่าน
- `make test-go` รันทุกเทสต์ (ถ้า Postgres เปิดอยู่ก็รันเทสต์ที่ใช้ DB ด้วย)
- เทสต์ใน `router_test.go` ใช้ชื่อบอกเรื่องเลย เช่น `TestWorkflowFromDraftToAccepted`, `TestAdminDeletes`
- `go doc ./internal/quote Service.Approve` ดูเอกสารของฟังก์ชันจาก terminal

---

## 2. Spring Boot (Java 21): `backend/spring-boot-service`

### โครงสร้าง
```
src/main/java/com/swiftquote/
  SpringBootServiceApplication.java   จุดเริ่ม; Spring สแกนและสร้าง bean ให้เอง
  config/       SecurityConfig (CORS, ไม่ใช้ filter login ของ Spring), WebConfig (path ไม่สนตัวพิมพ์ เหมือน Go)
  domain/       record ข้อมูล (Quote, Actor, ...), ค่าคงที่ Roles/Statuses, ApiException
  web/rest/     ApiController (ทุก endpoint), Dtos, ActorResolver, JsonBody, ApiExceptionHandler
  service/      กฎธุรกิจ (QuoteService, AdminService, ...)
  repository/   SQL ผ่าน JdbcClient (ไม่ได้ใช้ JPA)
src/test/java/...  ApiIntegrationTest (Testcontainers เปิด Postgres จริง), PricingTest
```

### Annotation ที่ต้องรู้ (อ่าน Spring = อ่าน annotation)
| Annotation | ความหมาย |
|---|---|
| `@RestController` | class นี้รับ HTTP และตอบเป็น JSON |
| `@PostMapping("/quotes/{id}/approve")` | method นี้คือ route นั้น |
| `@PathVariable String id` | ดึง `{id}` จาก URL |
| `@Service`, `@Repository` | ให้ Spring สร้าง object นี้ไว้ (bean) แล้วส่งให้คนที่ต้องการ |
| constructor ที่รับ service อื่นเข้ามา | **dependency injection:** Spring ส่งของให้ผ่าน constructor ไม่ต้อง `new` เอง |
| `@ExceptionHandler` | จับ exception ที่โยนออกมาแล้วแปลงเป็น JSON error |

### ธรรมเนียมเฉพาะของโปรเจกต์นี้
- **error ใช้ exception:** service โยน `ApiException` (เช่น `ApiException.roleForbidden()`) แล้ว `ApiExceptionHandler` แปลงเป็น status code และ JSON ต่างจาก Go ที่ return error
- **`Actor actor` เป็นพารามิเตอร์ใน controller:** `ActorResolver` เป็นคนเติมค่าให้ โดยตรวจ token และโหลด role จาก DB เหมือน `requireAuth` ของ Go
- **`JsonBody` กับ `GoText`:** มีไว้ให้ Spring อ่าน JSON และ UUID **ด้วยกติกาเดียวกับ Go** ข้อความ error จะได้ตรงกันทุกตัวอักษร ถ้าเห็นโค้ดที่ดูอ้อม ส่วนใหญ่มีเหตุผลข้อนี้
- **`record`:** เช่น `record Ref(UUID id, String name)` เป็นคลาสข้อมูลที่แก้ไขไม่ได้ ได้ getter, `equals` และ `toString` มาเอง
- **เงินใช้ `BigDecimal` เสมอ:** ปัดแบบ `HALF_UP` และตอบออกไปเป็นทศนิยม 2 ตำแหน่ง

### ไล่ตัวอย่าง: WO อนุมัติ
1. **route และ handler:** [`ApiController.java`](../backend/spring-boot-service/src/main/java/com/swiftquote/web/rest/ApiController.java)
   ```java
   @PostMapping("/quotes/{id}/approve")
   QuoteDetail approveQuote(Actor actor, @PathVariable String id, @RequestBody(required = false) byte[] body) {
       ... return QuoteDetail.of(this.quotes.approve(actor, pathId(id), comment));
   }
   ```
2. **service:** `approve` ใน [`QuoteService.java`](../backend/spring-boot-service/src/main/java/com/swiftquote/service/QuoteService.java) มีโครงเหมือน Go บรรทัดต่อบรรทัด:
   ```java
   if (!Roles.WO.equals(a.role())) throw ApiException.roleForbidden();
   Quote q = visible(a, id);
   return transition(a, q, "approve", List.of(Statuses.PENDING_APPROVAL), Statuses.APPROVED, ...);
   ```
3. **repository:** `transition` ใน [`QuoteRepository.java`](../backend/spring-boot-service/src/main/java/com/swiftquote/repository/QuoteRepository.java) ใช้ SQL `UPDATE ... WHERE status = ANY(...)` แบบเดียวกับ Go

### เครื่องมือช่วยอ่าน
- `make test-spring` (ต้องเปิด Docker ไว้ เพราะ Testcontainers สร้าง Postgres ชั่วคราวให้)
- ใน IntelliJ ให้ใช้ *Find Usages* กับ method ของ service จะเห็นว่า controller ไหนเรียก

---

## 3. Node.js (Fastify + TypeScript): `backend/node-service`

### โครงสร้าง (ไฟล์แบนในโฟลเดอร์เดียว)
```
src/
  server.ts       จุดเริ่ม: อ่าน env, สร้าง Repository และ service ทุกตัว, เรียก buildApp แล้ว listen
  app.ts          buildApp: route ทั้งหมด, requireAuth, ตัวแปลง error, 405
  services.ts     AuthService, QuoteService (กฎธุรกิจหลัก)
  admin.ts        AdminService, CatalogService, ClientService, DashboardService
  repository.ts   SQL ทั้งหมด (pg)
  views.ts        แปลง object ภายในเป็น JSON ตาม contract (เทียบได้กับ dto.go)
  domain.ts       type กลางและ error
  gojson.ts       อ่าน request body ด้วยกติกาเดียวกับ Go (ข้อความ error จะได้ตรงกัน)
  json.ts         เขียน JSON โดยรักษาเงินให้เป็นทศนิยม 2 ตำแหน่ง (เช่น 50236.50)
  pricing.ts      คำนวณราคา (decimal.js)
  *.test.ts       เทสต์ (vitest)
```

### ธรรมเนียมที่ต้องรู้
- **ทุกอย่างเป็น `async`/`await`:** การเรียก DB คืนค่าเป็น Promise
- **error ใช้ `throw`** (เช่น `throw roleForbidden()`) แล้ว `setErrorHandler` ใน `app.ts` แปลงเป็น JSON
- **route ไม่ได้เขียนทีละบรรทัดแบบ Go:** `app.ts` มีตาราง เช่น `actions = { approve: ..., submit: ... }` แล้ววนลูปสร้าง route ถ้าค้นด้วย `grep "/approve"` จะไม่เจอ ต้องค้นคำว่า `approve:` แทน
- **ไม่ใช้ `JSON.parse` ตรง ๆ กับ body:** ใช้ `gojson.ts` เพื่อให้ error ตรงกับ Go
- **เงิน:** ใช้ `decimal.js` ห้ามใช้ `number` ในการคำนวณ

### ไล่ตัวอย่าง: WO อนุมัติ
1. **route:** ใน [`app.ts`](../backend/node-service/src/app.ts) ตาราง `actions` มี `approve: (a, id, c) => d.quotes.approve(a, id, c)` และลูปด้านล่างสร้าง `POST /quotes/:id/approve` พร้อม `preHandler: requireAuth`
2. **service:** `approve` ใน [`services.ts`](../backend/node-service/src/services.ts)
   ```ts
   if (a.role !== 'wo') throw roleForbidden()
   const q = await this.visible(a, id)
   return this.transition(a, q, 'approve', ['pending_approval'], 'approved', 'approved', comment)
   ```
3. **repository:** `transition` ใน [`repository.ts`](../backend/node-service/src/repository.ts) ใช้ SQL เดียวกับ Go
4. **แปลงเป็น JSON:** `views.ts` แล้วส่งผ่าน `json.ts`

### เครื่องมือช่วยอ่าน
- `make test-node` (ถ้า Postgres เปิดอยู่จะรันเทสต์ที่ใช้ DB ด้วย)
- ใน VS Code ใช้ *Go to Definition* (F12) ได้ทุกที่ เพราะทั้งหมดเป็น TypeScript

> **เทียบ 3 backend:** `make parity` ส่ง request ชุดเดียวกันไปที่ Go กับ Spring และ Go กับ Node แล้วเทียบผลทุกตัวอักษร
> ถ้าแก้กฎใน backend ไหน ต้องแก้ให้ครบทั้ง 3 ตัว แล้วรัน parity ให้ผ่าน

---

## Frontend: โครงร่วมของทั้ง 3 แอป

ทั้ง 3 แอปมีหน้าตาและฟีเจอร์เหมือนกัน และจัดไฟล์ด้วยหลักเดียวกัน:

| โฟลเดอร์ | มีอะไร |
|---|---|
| `pages/` (Next.js: `app/`) | 1 โฟลเดอร์ต่อ 1 หน้า และคอมโพเนนต์ที่ใช้เฉพาะหน้านั้น |
| `components/` | คอมโพเนนต์ที่หลายหน้าใช้ร่วมกัน: layout, StatusChip, SignaturePad |
| `services/` | **ทุกการเรียก API อยู่ที่นี่** 1 service ต่อ 1 หน้า เช่น `quoteDetailService` |
| `models/` | interface ของข้อมูล (`QuoteDetail`, `AdminUser`, ...) ซึ่ง extends จาก type ที่ generate จาก contract |
| `api/schema.d.ts` | generate จาก `openapi.yaml` ด้วย `make gen-types` **ห้ามแก้เอง** |
| `pricing` | คำนวณราคาแบบเดียวกับ server ไว้แสดงยอดสดตอนกรอก |

**ทางที่การกดปุ่มวิ่งผ่าน (เหมือนกันทั้ง 3 แอป):**
```
หน้า (page)  →  เช็กว่า role นี้กดปุ่มได้ไหม (availableActions)  →  เปิดกล่องใส่ comment
            →  service ของหน้า (quoteDetailService.approve)  →  HTTP client ใส่ token ให้
            →  API  →  ได้ QuoteDetail ใหม่กลับมา แล้ววาดหน้าใหม่
```
`availableActions` ฝั่งหน้าเว็บมีไว้ **ซ่อนปุ่มเท่านั้น** ตัวที่ตัดสินจริงคือ backend เสมอ

---

## 4. React + MUI (Vite): `frontend/react-mui-app`

### อ่านตามลำดับนี้
1. `src/main.tsx` เป็นจุดเริ่ม ห่อแอปด้วย Theme, Router และ `AuthProvider`
2. `src/App.tsx` เป็นตารางหน้าทั้งหมด แต่ละกลุ่มห่อด้วย `<AppLayout roles={[...]}>` ซึ่งเป็นตัวกันว่าใครเข้าหน้าไหนได้
3. `src/auth/AuthProvider.tsx` เก็บว่าใคร login อยู่ (`useAuth()`) เก็บ token ไว้ใน localStorage และคอยฟังแท็บอื่น
4. `src/api/http.ts` คือ axios ตัวเดียวของแอป: กำหนด base URL, แนบ Bearer token และถ้าได้ 401 จะ logout
5. ต่อจากนั้นเปิดหน้าที่สนใจใน `src/pages/...` ตามด้วย service ของหน้านั้นใน `src/services/...`

### ธรรมเนียมของ React ที่ต้องรู้
- **คอมโพเนนต์คือฟังก์ชันที่คืน JSX:** อ่านจาก `return (...)` ด้านล่างก่อนจะเห็นหน้าตา แล้วค่อยย้อนขึ้นไปดู state
- **`useState`** คือข้อมูลที่เปลี่ยนแล้วหน้าจอวาดใหม่ **`useEffect`** คือสิ่งที่ทำหลังวาด เช่นโหลดข้อมูล ให้ดู dependency array `[...]` ว่ารันใหม่เมื่ออะไรเปลี่ยน
- **หน้าโหลดข้อมูลแบบมี `cancelled`:** ถ้าออกจากหน้าก่อนข้อมูลมาถึง จะไม่เขียนทับ state

### ไล่ตัวอย่าง: WO อนุมัติ
- **ปุ่ม:** [`pages/quote-detail/QuoteDetailPage.tsx`](../frontend/react-mui-app/src/pages/quote-detail/QuoteDetailPage.tsx) มีฟังก์ชัน `availableActions(role, q)` ที่ให้ `approve: role === 'wo' && q.status === 'pending_approval'` ถ้าเป็นจริงจะแสดงปุ่ม Approve ซึ่งเปิดกล่อง `DIALOGS.approve`
- **API:** [`services/quoteDetailService.ts`](../frontend/react-mui-app/src/services/quoteDetailService.ts) มี `approve(id, comment)` ซึ่งเรียก `http.post('/quotes/{id}/approve', { comment })`
- **token และ 401:** จัดการใน [`api/http.ts`](../frontend/react-mui-app/src/api/http.ts)

`make test-react` รัน lint, เทสต์ และ build ส่วน `npm run dev` ในโฟลเดอร์แอปเปิดที่ :3000

---

## 5. Next.js (App Router): `frontend/nextjs-app`

Next.js ต่างจาก React ตรงที่ **โค้ดบางส่วนรันบน server** ต้องรู้ก่อนว่ากำลังอ่านฝั่งไหนอยู่

### กฎของ App Router (โฟลเดอร์ = URL)
| สิ่งที่เห็น | ความหมาย |
|---|---|
| `app/(app)/quotes/page.tsx` | หน้าที่ `/quotes` ส่วน `(app)` ในวงเล็บเป็นกลุ่ม **ไม่ปรากฏใน URL** ใช้รวมหน้าที่ต้อง login และใช้ layout เดียวกัน |
| `app/(app)/quotes/[id]/page.tsx` | `[id]` เป็นตัวแปรใน URL เช่น `/quotes/abc` |
| `app/(app)/quotes/_builder/` | ขึ้นต้นด้วย `_` เป็นโฟลเดอร์ **ส่วนตัว** ไม่กลายเป็น URL ใช้เก็บคอมโพเนนต์ที่หน้า new และ edit ใช้ร่วมกัน |
| `layout.tsx` | ครอบทุกหน้าในโฟลเดอร์นั้น |
| `'use client'` บรรทัดแรก | ไฟล์นี้รันในเบราว์เซอร์ (มี state, คลิกได้) **ถ้าไม่มี แปลว่ารันบน server** |
| `import 'server-only'` | ห้ามไฟล์นี้หลุดไปฝั่งเบราว์เซอร์ (เช่นตัวตรวจ JWT) |

### อ่านตามลำดับนี้
1. `src/proxy.ts` กันชั้นแรก: ไม่มี cookie ก็ส่งไป `/login`
2. `src/lib/auth/guard.ts` มี `getSession()` ที่ **ตรวจลายเซ็น JWT บน server** แล้วเอา role จาก token และ `requireRole([...])` ที่ทุกหน้าเรียก
3. `src/app/layout.tsx` ห่อทั้งแอปด้วย `components/Providers.tsx` ซึ่งมี `AuthProvider` เก็บสถานะ login ฝั่งเบราว์เซอร์ (cookie) และคอยฟังแท็บอื่น ส่วน `src/app/(app)/layout.tsx` เป็น layout ของหน้าที่ต้อง login
4. HTTP client มี 2 ตัว:
   - `lib/api/http.ts` ฝั่งเบราว์เซอร์
   - `lib/api/server.ts` ฝั่ง server ใช้ token จาก cookie และ `API_INTERNAL_URL`
5. หน้า Dashboard (`app/(app)/dashboard/page.tsx`) เป็น **Server Component**: ดึงข้อมูลบน server แล้วส่งให้ `DashboardView.tsx` (client) จัดการปุ่มสลับมุมมอง

### ไล่ตัวอย่าง: WO อนุมัติ
- **ฝั่ง server:** [`app/(app)/quotes/[id]/page.tsx`](../frontend/nextjs-app/src/app/%28app%29/quotes/%5Bid%5D/page.tsx) เรียก `requireRole([...])` ก่อน แล้วส่ง `id` และ `role` ให้คอมโพเนนต์
- **ฝั่งเบราว์เซอร์:** [`QuoteDetail.tsx`](../frontend/nextjs-app/src/app/%28app%29/quotes/%5Bid%5D/QuoteDetail.tsx) มี `availableActions` แบบเดียวกับ React แล้วเรียก `quoteDetailService.approve(id, comment)` จาก [`services/quoteDetailService.ts`](../frontend/nextjs-app/src/services/quoteDetailService.ts)

`make test-next` รัน lint, typecheck, เทสต์ และ build ส่วน `npm run dev` เปิดที่ :3001 (มี `.env.development` ที่ใส่ `JWT_SECRET` ของ dev ไว้แล้ว)

---

## 6. Angular (Standalone + Signals): `frontend/angular-app`

### อ่านตามลำดับนี้
1. `src/app/app.config.ts` ลงทะเบียนของที่ทั้งแอปใช้: router, HttpClient และ `authInterceptor`
2. `src/app/app.routes.ts` เป็นตาราง URL โหลดหน้าแบบ lazy (`loadComponent`) และมี `canActivate: [roleGuard([...])]` เป็นตัวกันสิทธิ์
3. `src/app/core/` เก็บของที่ใช้ทั้งแอป: `auth.interceptor.ts` (แนบ token และจัดการ 401), `guards.ts`, `token.ts` และ `core/api` (URL, `errorText`)
4. `src/app/services/` มี service ต่อหน้าที่ใช้ `HttpClient` และ **คืนค่าเป็น `Observable`** ส่วน `auth.service.ts` เก็บสถานะ login เป็น signal
5. `src/app/pages/<หน้า>/` แต่ละหน้ามักมี `xxx-page.ts` (logic) คู่กับ `xxx-page.html` (template)

### ธรรมเนียมของ Angular ในโปรเจกต์นี้
| สิ่งที่เห็น | ความหมาย |
|---|---|
| `@Component({ standalone ..., imports: [...] })` | คอมโพเนนต์ประกาศเองว่าใช้อะไร (ไม่มี NgModule) |
| `inject(QuoteDetailService)` | dependency injection: ขอ service มาใช้ |
| `signal(...)` / `computed(...)` | state และค่าที่คำนวณจาก state; ใน template อ่านด้วย `name()` (มีวงเล็บ) |
| `rxResource({ stream: () => ... })` | โหลดข้อมูลจาก Observable แล้วได้สถานะ loading, value และ error เป็น signal |
| `.subscribe(...)` + `finalize` | ใช้กับ action เช่นกดอนุมัติ; `takeUntilDestroyed` ยกเลิกเองเมื่อออกจากหน้า |
| `@if (...) { }`, `@for (...) { }` ใน `.html` | control flow แบบใหม่ ใช้แทน `*ngIf` และ `*ngFor` |
| `ChangeDetectionStrategy.OnPush` และไม่มี zone.js | หน้าจอวาดใหม่เมื่อ signal เปลี่ยน |

### ไล่ตัวอย่าง: WO อนุมัติ
- **ปุ่ม:** [`pages/quote-detail/quote-detail-page.ts`](../frontend/angular-app/src/app/pages/quote-detail/quote-detail-page.ts) มี `availableActions(role, q)` ส่วนปุ่ม Approve อยู่ใน `quote-detail-page.html` เมื่อกดจะเปิด `CommentDialog` ผ่าน `openDialog(...)`
- **API:** [`services/quote-detail.service.ts`](../frontend/angular-app/src/app/services/quote-detail.service.ts) มี `commentAction(id, 'approve', comment)` ซึ่งคืน `Observable<QuoteDetail>` จาก `http.post(.../approve)`
- **token:** แนบให้ใน [`core/auth.interceptor.ts`](../frontend/angular-app/src/app/core/auth.interceptor.ts)

`make test-angular` (ต้องใช้ Node 22.22.3 ขึ้นไป) ส่วน `npm start` เปิดที่ :3002

---

## 7. สูตรลัด

### หาว่าเรื่องนี้อยู่ตรงไหน
```bash
# endpoint นี้ทำอะไร: อ่าน contract ก่อน
grep -n "/quotes/{id}/approve" -A30 contracts/openapi.yaml

# ข้อความ error นี้มาจากไหน (ข้อความเหมือนกันทั้ง 3 backend)
grep -rn "cannot delete yourself" backend/

# หน้าไหนเรียก API นี้
grep -rn "/approve" frontend/*/src --include=*Service.ts --include=*.service.ts
```

### เพิ่มฟีเจอร์ใหม่ ต้องแตะอะไรบ้าง (ตามลำดับ)
1. `contracts/openapi.yaml` แล้วรัน `npx @stoplight/spectral-cli lint contracts/openapi.yaml --ruleset contracts/spectral.yml`
2. `make gen-types` แล้วเพิ่ม interface ใหม่ในไฟล์ `models/` ที่ตรงหมวด (ทั้ง 3 frontend)
3. **Go ก่อน** (service, repository, handler และเทสต์ใน `router_test.go`) แล้ว `make test-go`
4. Spring และ Node ให้ได้ข้อความ, status และลำดับการตรวจเหมือน Go แล้ว `make test-spring` และ `make test-node`
5. เพิ่มขั้นใน `scripts/parity.py` แล้วรัน `make parity` ให้ผ่าน
6. Frontend ทั้ง 3 ตัว: service ของหน้า และหน้าเอง แล้ว `make test-react`, `make test-next`, `make test-angular`
7. ทำบน branch แล้วเปิด PR (`main` รับงานผ่าน PR เท่านั้น)

### คำที่เจอบ่อยในโค้ด
| คำ | ความหมาย |
|---|---|
| actor | ผู้ที่ส่ง request นี้ (id, org, role) โหลดจาก DB ใหม่ทุกครั้ง |
| visible | ใบเสนอราคานี้ role นี้มองเห็นไหม (rm เห็นของตัวเอง, wo เห็นของทีม, woc เห็นทั้งหมด, customer เห็นของบริษัทตัวเองที่ส่งแล้ว) |
| transition | เปลี่ยนสถานะพร้อมบันทึกประวัติ เฉพาะเมื่อสถานะปัจจุบันอยู่ในรายการที่อนุญาต |
| access token (share link) | UUID ในลิงก์ `/p/<token>` ที่ให้ลูกค้าเปิดดูโดยไม่ต้อง login (ใช้ได้ตั้งแต่ส่งแล้วเท่านั้น) |
| parity | การเทียบผลของ backend ทั้ง 3 ตัวให้ตรงกันทุกตัวอักษร |
