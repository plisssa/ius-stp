---

description: "Task list for feature 001-stp-ticket-processing"
---

# Tasks: Обработка обращений в службу технической поддержки (СТП)

**Input**: Design documents from `/specs/001-stp-ticket-processing/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: включены. Их требуют принцип конституции P7 (критерии приёмки → автотесты), решение R12 плана и требование ИИ-07 (набор ≥ 20 сценариев prompt injection). Тесты истории пишутся первыми и должны падать до реализации.

**Organization**: задачи сгруппированы по пользовательским историям US1–US6 из spec.md; каждую историю можно реализовать и проверить отдельно.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: можно выполнять параллельно (разные файлы, нет зависимостей от незавершённых задач)
- **[Story]**: история из spec.md (US1…US6)
- Пути — по структуре из plan.md: ядро `src/stp/`, ассистент `assistant/`, MCP-серверы `mcp_servers/`, тесты `tests/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: инициализация проекта и окружения

- [ ] T001 Create project structure per plan.md: `src/stp/{core,tickets,sla,notify,events,refdata,reports,audit,portal,desk,admin}/`, `assistant/`, `mcp_servers/{tickets,kb,staff}/`, `migrations/`, `tests/{unit,contract,integration,security}/`, `seed/`, `data/`
- [ ] T002 Initialize Python 3.12 project in pyproject.toml with FastAPI, Pydantic v2, SQLAlchemy 2.0, Alembic, Jinja2, argon2-cffi, httpx, official MCP Python SDK, pytest, time-machine
- [ ] T003 [P] Configure linting and formatting (ruff, mypy) in ruff.toml and mypy.ini
- [ ] T004 [P] Create docker-compose.yml with services app, worker, postgres:16, mailpit, slack-stub, assistant, mcp-tickets, mcp-kb, mcp-staff and .env.example with DATABASE_URL, SMTP_HOST, SLACK_WEBHOOK_URL, STP_CLOCK

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: общая инфраструктура, без которой нельзя начинать ни одну историю

**⚠️ CRITICAL**: работа над историями начинается только после завершения фазы

- [ ] T005 Implement settings loading from environment in src/stp/core/config.py
- [ ] T006 [P] Implement controllable clock in src/stp/core/clock.py (`STP_CLOCK=system` или `fixed:<ISO-время>`, смещение хранится в БД) and CLI `advance <интервал>` in src/stp/clock.py
- [ ] T007 Setup database engine, session and Alembic environment in src/stp/core/db.py and migrations/env.py
- [ ] T008 Create reference models in src/stp/refdata/models.py and migration migrations/versions/0001_refdata.py: Organization (`name` — «обязательно, уникально»; `support_type` — `standard` | `extended`; `sla_hours_type` — `business` | `calendar`; `timezone` — IANA-зона; `business_hours`), SlaNorm (`priority` — `P1`…`P4`, «уникально в паре с организацией»; `first_response_hours` — «целое > 0»), ClientUser, Engineer (`level` — `L1` | `L2` | `L3`; `is_head`), EngineerCompetence, TicketType (4 значения: functionality, configuration, defect, release), Product, Installation, ProductionCalendar (FR-005)
- [ ] T009 Create ticket models in src/stp/tickets/models.py and migration migrations/versions/0002_tickets.py: Ticket (`seq_number` из последовательности; `status` — `waiting_for_support` | `waiting_for_customer` | `closed`; `assignee_id` пусто = «Unassigned»; `sla_state` — `pending` | `met` | `breached`; `close_reason` — `resolved` | `no_customer_reply`; поля дедлайна, warn_at, warn_sent_at, breach_recorded_at, first_response_at, last_engineer_reply_at, reopen_until), TicketMessage (`kind` — 7 значений из data-model.md; частичный уникальный индекс: `is_first_response` «истина только у одного сообщения заявки»)
- [ ] T010 [P] Create audit history in src/stp/audit/models.py and migration migrations/versions/0003_audit.py: схема `audit`, TicketHistoryEvent; права UPDATE и DELETE отозваны у всех ролей; ограничение: `reason` обязательна для `assignee_changed`, `escalated`, `priority_changed` (FR-022)
- [ ] T011 [P] Create outbox model and dispatcher skeleton in src/stp/events/outbox.py and migration migrations/versions/0004_outbox.py (запись в той же транзакции, доставка не менее одного раза, `attempts`, идемпотентность по `event_id`)
- [ ] T012 Implement authentication and roles in src/stp/core/security.py: учётные записи портала с хешем argon2id, локальные учётные записи сотрудников (OIDC — позже), роли Клиент / Инженер / Руководитель / Администратор, зависимость проверки принадлежности заявки организации
- [ ] T013 [P] Implement error handlers (401, 403, 404, 409, 422 по contracts/http-api.yaml) and JSON logging in src/stp/core/errors.py and src/stp/core/logging.py
- [ ] T014 Create application factory with router registration and base template in src/stp/app.py and src/stp/templates/base.html
- [ ] T015 Create worker entrypoint with 30-second loop for SLA scheduler and outbox dispatcher in src/stp/worker.py
- [ ] T016 [P] Prepare production calendar data from the official RF calendar for 2026–2027 in data/production_calendar_ru_2026_2027.csv
- [ ] T017 Implement seed script in src/stp/seed.py: «Альфа» (standard, business, P1–P4 = 1 / 4 / 8 / 24 ч), «Бета» (extended, calendar, те же нормативы), клиенты Иванов и Петрова («Альфа»), Сидоров («Бета»), инженеры L1 ×2, L2, L3 и руководитель, загрузка календаря из data/
- [ ] T018 [P] Create shared test fixtures (тестовая БД, seed, подменяемые часы) in tests/conftest.py and OpenAPI response validator against contracts/http-api.yaml in tests/contract/conftest.py

**Checkpoint**: фундамент готов — можно начинать истории

---

## Phase 3: User Story 1 - Клиент создаёт заявку, поддержка узнаёт о ней (Priority: P1) 🎯 MVP

**Goal**: регистрация заявки с номером ES-NNNN и уведомления инженерам по почте и в Slack

**Independent Test**: создать заявку от имени клиента и проверить номер, статус, исполнителя и доставку уведомлений (quickstart Q1, Q2, Q11)

### Tests for User Story 1

- [ ] T019 [P] [US1] Contract test for POST/GET /api/v1/tickets and GET /api/v1/tickets/{number} in tests/contract/test_portal_tickets.py
- [ ] T020 [P] [US1] Integration test for registration and notifications within 1 minute (Q1) in tests/integration/test_us1_registration.py
- [ ] T021 [P] [US1] Security test for 403 on another organization's ticket (Q2) in tests/security/test_cross_org_access.py
- [ ] T022 [P] [US1] Unit test for number format «`ES-` + номер, дополненный нулями до 4 цифр; после 9999 — без ограничения длины (ES-10000)» (Q11) in tests/unit/test_ticket_number.py

### Implementation for User Story 1

- [ ] T023 [P] [US1] Implement ticket number formatting from sequence in src/stp/tickets/numbering.py (FR-002)
- [ ] T024 [US1] Implement registration service in src/stp/tickets/service.py: статус `waiting_for_support`, исполнитель пуст, организация и автор, событие истории `registered` и событие outbox `ticket.registered` в одной транзакции (FR-001…FR-003; depends on T023)
- [ ] T025 [US1] Implement portal API in src/stp/portal/api.py: POST/GET /api/v1/tickets, GET /api/v1/tickets/{number} с проверкой организации (FR-004)
- [ ] T026 [P] [US1] Create portal pages (форма заявки, список, карточка) in src/stp/portal/views.py and src/stp/portal/templates/
- [ ] T027 [P] [US1] Implement e-mail adapter (отдельное письмо на получателя: номер, организация, тема, приоритет, статус) in src/stp/notify/email.py
- [ ] T028 [P] [US1] Implement Slack webhook adapter in src/stp/notify/slack.py and stub receiver for prototype in src/stp/notify/slack_stub.py
- [ ] T029 [US1] Implement notification subscriber for `ticket.registered`, `ticket.updated`, `ticket.status_changed` with «не более одного письма на получателя и одного сообщения в Slack» per event in src/stp/notify/subscriber.py (FR-011; depends on T027, T028)

**Checkpoint**: US1 работает и проверяется отдельно

---

## Phase 4: User Story 2 - Система контролирует SLA первого ответа (Priority: P2)

**Goal**: дедлайн по договору организации, предупреждение за час, фиксация нарушения, отметка о соблюдении по первому ответу

**Independent Test**: с подменой часов проверить дедлайны, предупреждение, нарушение и соблюдение (quickstart Q3–Q7)

### Tests for User Story 2

- [ ] T030 [P] [US2] Unit tests for deadline calculation in tests/unit/test_sla_deadline.py: «Альфа» P2, понедельник 16:00 → вторник 11:00; «Бета» P2, суббота 10:00 → суббота 14:00; норматив ≤ 1 ч → `warn_at` = `registered_at`; смена типа часов действует только на новые заявки
- [ ] T031 [P] [US2] Integration test for warning at 13:00 and breach at 14:00 with recipients (Q5) in tests/integration/test_us2_sla_events.py
- [ ] T032 [P] [US2] Integration test for worker stopped before deadline and restarted (Q6, без дублей) in tests/integration/test_us2_sla_restart.py
- [ ] T033 [P] [US2] Integration test for first response by info request (Q7) in tests/integration/test_us2_first_response.py

### Implementation for User Story 2

- [ ] T034 [P] [US2] Implement production calendar and business-hours arithmetic in organization timezone in src/stp/sla/calendar.py (FR-007)
- [ ] T035 [US2] Implement deadline calculator in src/stp/sla/deadline.py: `first_response_due_at` = регистрация + норматив в типе часов организации, «рассчитывается при регистрации, не пересчитывается»; `warn_at` = due − 1 ч, «если норматив ≤ 1 ч — = registered_at» (depends on T034; FR-006, FR-007)
- [ ] T036 [US2] Call deadline calculator during registration in src/stp/tickets/service.py (depends on T024, T035)
- [ ] T037 [US2] Implement SLA scheduler in src/stp/sla/scheduler.py: выборка с `FOR UPDATE SKIP LOCKED`; предупреждение при `warn_at ≤ now`, нет первого ответа и пустом `warn_sent_at` → `sla.warning_due`; нарушение при `due ≤ now` → `sla_state = breached` («не снимается»), `breach_recorded_at`, `sla.breached`; подключить в src/stp/worker.py
- [ ] T038 [US2] Implement engineer responses in src/stp/tickets/responses.py: виды `answer`, `info_request`, `priority_justification_request`; первый ответ назначает исполнителя, если его нет, ставит `is_first_response`, `sla_state = met` до дедлайна, статус `waiting_for_customer`, `last_engineer_reply_at`, событие `ticket.first_response_published` (FR-010)
- [ ] T039 [US2] Implement desk API POST /api/v1/desk/tickets/{number}/responses and GET /api/v1/desk/queue with `sla_remaining_minutes` in src/stp/desk/api.py (FR-006)
- [ ] T040 [US2] Add recipients for `sla.warning_due` (все инженеры) and `sla.breached` (все инженеры и руководитель) in src/stp/notify/subscriber.py (FR-008, FR-009)
- [ ] T041 [P] [US2] Create desk queue page with remaining SLA time in src/stp/desk/templates/queue.html and src/stp/desk/views.py
- [ ] T042 [P] [US2] Create admin page for organization SLA settings (тип часов, нормативы P1–P4) in src/stp/admin/sla_views.py

**Checkpoint**: US1 и US2 работают независимо

---

## Phase 5: User Story 3 - Инженер и руководитель обрабатывают заявку (Priority: P3)

**Goal**: назначение, смена исполнителя, эскалация, изменение приоритета и инсталляции, расширенная поддержка

**Independent Test**: на заранее зарегистрированных заявках проверить назначение с причиной, эскалацию и правило расширенной поддержки (quickstart Q8)

### Tests for User Story 3

- [ ] T043 [P] [US3] Contract tests for desk endpoints assignee, escalate, priority, installation, remote-work-consent, engineers/availability in tests/contract/test_desk.py
- [ ] T044 [P] [US3] Integration test for assignment with reason and escalation to higher level only (Q8) in tests/integration/test_us3_assignment.py
- [ ] T045 [P] [US3] Integration test for extended support consent rule (EARS-13) in tests/integration/test_us3_extended_support.py

### Implementation for User Story 3

- [ ] T046 [US3] Implement assignee change with required reason, history `assignee_changed` and `ticket.updated` in src/stp/tickets/assignment.py (FR-012)
- [ ] T047 [US3] Implement escalation in src/stp/tickets/assignment.py: только инженеры уровня выше текущего (`L1` < `L2` < `L3`), причина обязательна, иначе 409; события `escalated` и `ticket.escalated` (FR-015; depends on T046)
- [ ] T048 [P] [US3] Implement priority and installation changes with required reason without recalculating the deadline in src/stp/tickets/editing.py (FR-014)
- [ ] T049 [P] [US3] Implement remote work consent only for `support_type = extended` with consent message reference in src/stp/tickets/remote_work.py (FR-016)
- [ ] T050 [P] [US3] Implement availability query (активные заявки в `waiting_for_support`, уровень, компетенции, прошлые заявки организации) in src/stp/refdata/availability.py (FR-013)
- [ ] T051 [US3] Add desk API routes for assignee, escalate, priority, installation, remote-work-consent, engineers/availability in src/stp/desk/api.py (depends on T046–T050)
- [ ] T052 [P] [US3] Create desk ticket card and assignment panel templates in src/stp/desk/templates/ticket_card.html and src/stp/desk/templates/assign_panel.html

**Checkpoint**: US1–US3 работают независимо

---

## Phase 6: User Story 4 - Ожидание клиента, закрытие и возобновление (Priority: P4)

**Goal**: ответы клиента, обратная связь, закрытие по правилам кейса, возобновление в течение 2 недель

**Independent Test**: на заявке в `waiting_for_customer` проверить все ветки (quickstart Q9, Q10)

### Tests for User Story 4

- [ ] T053 [P] [US4] Integration test for closing with `no_customer_reply` on Tuesday (409) and Wednesday (OK) after Friday 15:00 reply (Q9) in tests/integration/test_us4_close_no_reply.py
- [ ] T054 [P] [US4] Integration test for reopen on day 13 (OK, исполнитель прежний) and day 15 (409) (Q10) in tests/integration/test_us4_reopen.py
- [ ] T055 [P] [US4] Integration test for feedback «помогло» → `closed`/`resolved` and «не помогло» → `waiting_for_support` in tests/integration/test_us4_feedback.py

### Implementation for User Story 4

- [ ] T056 [US4] Implement status transition guard per data-model.md table («любой другой переход отклоняется … и не меняет данных») in src/stp/tickets/transitions.py
- [ ] T057 [US4] Implement client message, feedback and reopen in src/stp/tickets/client_actions.py: сообщение → `waiting_for_support` с прежним исполнителем и сбросом отсчёта; «помогло» → `closed`/`resolved`; «не помогло» → `waiting_for_support` и уведомление исполнителю; возобновление при now ≤ `reopen_until` (FR-017, FR-019, FR-020; depends on T056)
- [ ] T058 [US4] Implement closing in src/stp/tickets/closing.py: `no_customer_reply` только при ≥ 3 рабочих днях по производственному календарю от `last_engineer_reply_at` без сообщений клиента; `reopen_until` = `closed_at` + 14 дней (FR-018; depends on T034, T056)
- [ ] T059 [US4] Add portal routes for messages, feedback, reopen in src/stp/portal/api.py and desk close route in src/stp/desk/api.py
- [ ] T060 [P] [US4] Add feedback and reopen controls to portal ticket card in src/stp/portal/templates/ticket_card.html

**Checkpoint**: полный жизненный цикл заявки работает

---

## Phase 7: User Story 5 - Отчётность для руководителя (Priority: P5)

**Goal**: три отчёта за период

**Independent Test**: сравнить отчёты на тестовом наборе с ожидаемыми значениями (quickstart Q12)

### Tests for User Story 5

- [ ] T061 [P] [US5] Create test dataset with known distribution (Иванов: одна заявка `resolved`, одна `no_customer_reply`; Петрова: все `resolved`) in seed/reports_october.json
- [ ] T062 [P] [US5] Integration test for three reports for October (Q12) in tests/integration/test_us5_reports.py

### Implementation for User Story 5

- [ ] T063 [US5] Implement report queries in src/stp/reports/queries.py: число заявок по типам, по приоритетам; сотрудники организаций-клиентов, у которых за период есть заявка, не закрытая с причиной `resolved` (FR-021)
- [ ] T064 [US5] Add migration with indexes on registered_at, organization_id, type_code, priority for yearly report ≤ 10 s in migrations/versions/0005_report_indexes.py
- [ ] T065 [US5] Implement report API GET /api/v1/reports/tickets-by-type, tickets-by-priority, unsatisfied-clients in src/stp/reports/api.py
- [ ] T066 [P] [US5] Create reports page in src/stp/reports/templates/reports.html

**Checkpoint**: отчёты работают на данных US1–US4

---

## Phase 8: User Story 6 - ИИ-ассистент предлагает, инженер утверждает (Priority: P6)

**Goal**: предложения ассистента через MCP-серверы с allow-list, решение человека, деградация без влияния на ядро

**Independent Test**: проверить предложения, решения «Утвердить / Изменить / Отклонить», отключённый режим и набор prompt injection (quickstart Q13–Q16)

### Tests for User Story 6

- [ ] T067 [P] [US6] Create ≥ 20 prompt injection cases in seed/injection_cases.json and security test «0 вызовов вне allow-list с allowed = true; 0 изменений заявок без человека» (Q16) in tests/security/test_prompt_injection.py (FR-025)
- [ ] T068 [P] [US6] Integration test for proposal ≤ 60 s with fake model, approve/reject decisions and disabled mode (Q13–Q15) in tests/integration/test_us6_assistant.py
- [ ] T069 [P] [US6] Unit test for server-side allow-list rejection and logging with `allowed = false` in tests/unit/test_mcp_allowlist.py

### Implementation for User Story 6

- [ ] T070 [P] [US6] Create assistant models in src/stp/admin/assistant_models.py and migration migrations/versions/0006_assistant.py: AssistantProposal (`priority_flag` — `ok` | `possibly_higher` | `possibly_lower`; `status` — `proposed` | `approved` | `edited` | `rejected` | `unavailable`; `confidence` 0–1; `decided_by`, `decided_at` «заполняются только человеком»), AssistantToolCall, AssistantSettings (`confidence_threshold` по умолчанию 0,6; `timeout_seconds` 60)
- [ ] T071 [P] [US6] Add database roles in migrations/versions/0007_mcp_roles.py: роль «только чтение» для MCP-серверов; вставка только в assistant_proposal для `proposal.save`; вставка в assistant_tool_call
- [ ] T072 [P] [US6] Implement MCP server `tickets` with `tickets.get` (без ПДн автора), `tickets.search_similar` (та же организация, limit ≤ 5, закрытые `resolved`), `proposal.save` (JSON-схема Proposal, без изменения полей заявки) and server-side allow-list in mcp_servers/tickets/server.py
- [ ] T073 [P] [US6] Implement MCP server `kb` with `kb.search` (только опубликованные статьи, limit ≤ 5) on stub data in mcp_servers/kb/server.py and mcp_servers/kb/data/articles.json
- [ ] T074 [P] [US6] Implement MCP server `staff` with `staff.get_candidates` (детерминированный фильтр компетенций и уровня) and `staff.get_history_with_org` in mcp_servers/staff/server.py
- [ ] T075 [P] [US6] Implement PII masking (ФИО, контакты, адреса серверов) in assistant/masking.py
- [ ] T076 [P] [US6] Implement provider-agnostic model client with fake model for tests in assistant/llm.py
- [ ] T077 [US6] Implement harness in assistant/harness.py: подписка на `ticket.registered`, отдельный блок недоверенных данных, MCP-клиент, проверка вывода JSON-схемой, тайм-аут 60 с, порог уверенности 0,6 → статус `unavailable`, журнал каждого вызова инструмента (depends on T070–T076; FR-023, FR-025)
- [ ] T078 [US6] Implement proposal decision in src/stp/desk/proposals.py and route POST /api/v1/desk/tickets/{number}/proposal/decision: `approve`/`edit` применяют только утверждённые поля через сервисы ядра (T046 и смена типа), `reject` ничего не меняет; событие истории `proposal_decided`, outbox `assistant.proposal_decided` (FR-024, FR-027)
- [ ] T079 [P] [US6] Create proposal panel with «Утвердить / Изменить / Отклонить», обоснованием, источниками, уверенностью и пометкой «Ассистент недоступен» in src/stp/desk/templates/proposal_panel.html
- [ ] T080 [US6] Implement PUT /api/v1/admin/assistant (общий выключатель и функции A1–A4) in src/stp/admin/api.py (FR-026)
- [ ] T081 [P] [US6] Implement assistant quality metrics (доля принятых предложений по A1–A4, задержка, стоимость) and auto-disable after two weeks below threshold in src/stp/admin/assistant_metrics.py (ИИ-10)

**Checkpoint**: все истории работают независимо; ассистент отключаем без влияния на US1–US5

---

## Phase 9: Polish & Cross-Cutting Concerns

**Purpose**: доработки, затрагивающие несколько историй

- [ ] T082 [P] Add Prometheus metrics (число заявок, доля в SLA, задержка уведомлений) and OpenTelemetry tracing in src/stp/core/observability.py
- [ ] T083 [P] Document backup configuration (ежедневная полная копия, архивирование WAL не реже раза в час, восстановление на момент времени; RPO ≤ 1 ч, RTO ≤ 2 ч) in docs/ops/backup.md
- [ ] T084 Security hardening in src/stp/core/security.py: тайм-аут сессий, ограничение попыток входа, параметры argon2id
- [ ] T085 [P] Update docs/05-traceability.md with actual code files per component after implementation
- [ ] T086 Run quickstart.md scenarios Q1–Q16 and record results in specs/001-stp-ticket-processing/checklists/quickstart-results.md

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: без зависимостей
- **Foundational (Phase 2)**: после Setup — блокирует все истории
- **User Stories (Phase 3–8)**: после Foundational; по приоритету P1 → P6 или параллельно
- **Polish (Phase 9)**: после нужных историй

### User Story Dependencies

- **US1 (P1)**: только Foundational
- **US2 (P2)**: только Foundational; T036 дополняет сервис регистрации из US1 (T024) — при раздельной разработке выполняется после T024
- **US3 (P3)**: только Foundational; использует заявки из seed
- **US4 (P4)**: использует календарь из US2 (T034) для правила 3 рабочих дней
- **US5 (P5)**: только Foundational; данные из seed/reports_october.json
- **US6 (P6)**: событие `ticket.registered` из US1; применение решения — через сервис назначения US3 (T046)

### Within Each User Story

- Тесты пишутся первыми и падают до реализации
- Модели → сервисы → API → интерфейс
- История завершена до перехода к следующему приоритету

### Parallel Opportunities

- Setup: T003, T004
- Foundational: T006, T010, T011, T013, T016, T018
- Тесты каждой истории, отмеченные [P], — параллельно
- US6: MCP-серверы T072–T074, маскирование T075 и клиент модели T076 — параллельно

---

## Parallel Example: User Story 6

```bash
Task: "Implement MCP server tickets in mcp_servers/tickets/server.py"
Task: "Implement MCP server kb in mcp_servers/kb/server.py"
Task: "Implement MCP server staff in mcp_servers/staff/server.py"
Task: "Implement PII masking in assistant/masking.py"
Task: "Implement provider-agnostic model client in assistant/llm.py"
```

## Parallel Example: User Story 1

```bash
Task: "Contract test for /api/v1/tickets in tests/contract/test_portal_tickets.py"
Task: "Integration test for registration and notifications in tests/integration/test_us1_registration.py"
Task: "Implement e-mail adapter in src/stp/notify/email.py"
Task: "Implement Slack webhook adapter in src/stp/notify/slack.py"
```

---

## Implementation Strategy

### MVP First (User Story 1 + 2)

1. Phase 1 и Phase 2
2. US1 — регистрация и уведомления; **STOP and VALIDATE** (Q1, Q2, Q11)
3. US2 — контроль SLA; **STOP and VALIDATE** (Q3–Q7). US1 + US2 — минимальный продукт, ради которого существует система: заявки не теряются и SLA контролируется

### Incremental Delivery

1. US3 → US4 → US5 — полный процесс кейса и отчёты
2. US6 — ИИ-ассистент поверх готового ядра; отключение не ломает US1–US5

### Связь с этапом 2

Фрагмент для прототипа с ИИ-агентом в harness — US6 (Phase 8): состав инструментов (mcp-tools.md), guardrails и allow-list (T072–T077), журналирование вызовов (T070, T077), точки утверждения человеком (T078, T079).

---

## Notes

- [P] — разные файлы, нет зависимостей
- Метка [USn] связывает задачу с историей для трассируемости
- Коммит после каждой задачи или логической группы
- На любой контрольной точке историю можно проверить отдельно
