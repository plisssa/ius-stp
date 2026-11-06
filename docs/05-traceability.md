# 5. Матрица трассируемости

> Статус: **версия этапа 1 после SDD-цикла** — компоненты уточнены в `specs/001-stp-ticket-processing/plan.md` (G4), задачи — в `tasks.md`. Утверждено на human-gate G5 (06.11.2026). Колонку «Модуль кода» на этапе 2 нужно сверить с фактической реализацией (задача T085).

Полная цепочка: **требование (EARS) → правило кейса (BR) → элемент модели процесса (BPMN) → компонент архитектуры (C4) → модуль кода → задачи**.

## 5.1. Элементы архитектуры

Деление на контейнеры — в стиле C4 (уровень 2), по лекции 3. По решению R1 плана компоненты ядра реализуются модулями одного приложения, ИИ-ассистент и MCP-серверы — отдельными процессами.

| ID | Компонент | Ответственность | Модуль кода (plan.md) |
|---|---|---|---|
| C-PORTAL | Портал клиента (веб) | Создание заявок, переписка, обратная связь, возобновление | `src/stp/portal/` |
| C-DESK | Рабочее место инженера и руководителя (веб) | Очередь, карточка заявки, назначение, эскалация, экран утверждения предложений ассистента | `src/stp/desk/` |
| C-TICKET | Сервис заявок (system of record) | Номера, статусы, исполнитель, переписка, правила закрытия и возобновления | `src/stp/tickets/` |
| C-SLA | SLA-сервис | Дедлайны, планировщик, производственный календарь | `src/stp/sla/`, `src/stp/worker.py` |
| C-NOTIFY | Сервис уведомлений | Письма (SMTP) и сообщения в Slack по событиям | `src/stp/notify/` |
| C-BUS | Шина событий | События outbox (`contracts/events.md`) | `src/stp/events/` |
| C-REF | Справочники | Организации и SLA, инженеры (уровень, компетенции), типы, приоритеты, инсталляции | `src/stp/refdata/` |
| C-REPORT | Отчётный модуль | Отчёты ФТ-27…29, расчёт KPI | `src/stp/reports/` |
| C-AUDIT | Журнал аудита | Неизменяемая история изменений и решений | `src/stp/audit/` |
| C-AGENT | ИИ-ассистент в harness | Предложения А1–А4, guardrails, журнал вызовов инструментов | `assistant/` |
| MCP-TICKETS, MCP-KB, MCP-STAFF | MCP-серверы | Доступ агента к заявкам, базе знаний, данным об инженерах (allow-list — `contracts/mcp-tools.md`) | `mcp_servers/tickets/`, `kb/`, `staff/` |

## 5.2. EARS → процесс → архитектура → задачи

| EARS | Бизнес-правило | Элемент BPMN | Компонент | Требование spec | Задачи (tasks.md) | Принцип |
|---|---|---|---|---|---|---|
| EARS-01 | BR-02 | T_Register | C-TICKET | FR-002 | T022, T023 | P3 |
| EARS-02 | BR-01, BR-03, BR-04 | T_Submit, T_Register | C-PORTAL, C-TICKET | FR-001, FR-003, FR-004 | T019–T021, T024–T026 | P3 |
| EARS-03 | BR-07, BR-08 | T_StartSLA | C-SLA, C-REF | FR-005–FR-007 | T030, T034–T036, T042 | P4 |
| EARS-04 | BR-11 | ICE_Warn, T_Warn | C-SLA, C-NOTIFY | FR-008 | T031, T037, T040 | P4 |
| EARS-05 | BR-10 | ICE_Breach, T_Breach, EE_Breach | C-SLA, C-NOTIFY, C-AUDIT | FR-009 | T031, T032, T037, T040 | P4, P6 |
| EARS-06 | BR-05, BR-09, BR-16, BR-18 | T_RecordResponse, ITE_FirstResp, ICE_FirstResp1/2 | C-TICKET, C-SLA, C-BUS | FR-010 | T033, T038, T039 | P4 |
| EARS-07 | BR-12 | T_Notify | C-NOTIFY, C-BUS | FR-011 | T020, T027–T029 | P3 |
| EARS-08 | BR-06, BR-13 | T_HeadAssign | C-DESK, C-TICKET, C-AUDIT | FR-012, FR-013 | T044, T046, T050–T052 | P6 |
| EARS-09 | BR-15 | T_Escalate | C-DESK, C-TICKET, C-REF | FR-015 | T044, T047, T051 | P6 |
| EARS-10 | BR-19 | BT_3days, GW_CloseNoReply, T_CloseDecision | C-TICKET, C-SLA | FR-018 | T053, T058 | P4 |
| EARS-11 | BR-20 | EBG_Reopen, ICE_Reopen, ICE_2weeks | C-PORTAL, C-TICKET | FR-020 | T054, T057, T059, T060 | P3 |
| EARS-12 | BR-21 | T_ClientReview, GW_Solved | C-PORTAL, C-TICKET | FR-017 | T055, T057, T059 | P3 |
| EARS-13 | BR-17 | GW_Extended, T_RemoteDiag | C-DESK, C-REF | FR-016 | T045, T049 | P5 |
| EARS-14 | TO-BE (1.7) | T_AIProposal | C-AGENT, MCP-TICKETS, MCP-KB, MCP-STAFF, C-DESK | FR-023, FR-024, FR-027 | T068, T070–T079 | P2, P5, P6 |
| EARS-15 | TO-BE (1.7) | T_AIProposal (деградация) | C-AGENT, C-TICKET, C-SLA | FR-026 | T068, T077, T080 | P4 |

Требования spec вне EARS: FR-014 (приоритет и инсталляция) → T048; FR-019 (закрытие «решено») → T055, T057; FR-021 (отчёты) → T061–T066; FR-022 (история) → T010; FR-025 (недоверенные данные) → T067, T077.

## 5.3. Покрытие бизнес-правил

Проверка обратного направления: каждое правило кейса закрыто хотя бы одним требованием.

| BR | EARS | ФТ |
|---|---|---|
| BR-01 | EARS-02 | ФТ-01, ФТ-02 |
| BR-02 | EARS-01 | ФТ-03 |
| BR-03, BR-04 | EARS-02 | ФТ-03 |
| BR-05 | EARS-06 | ФТ-08 |
| BR-06 | EARS-08, EARS-09 | ФТ-09 |
| BR-07, BR-08 | EARS-03 | ФТ-17, ФТ-18 |
| BR-09 | EARS-06 | ФТ-21 |
| BR-10 | EARS-05 | ФТ-20 |
| BR-11 | EARS-04 | ФТ-19 |
| BR-12 | EARS-07 | ФТ-22, ФТ-23 |
| BR-13 | EARS-08 | ФТ-07, ФТ-09, ФТ-16 |
| BR-14 | — | ФТ-10, ФТ-11 |
| BR-15 | EARS-09 | ФТ-13 |
| BR-16 | EARS-06 | ФТ-12 |
| BR-17 | EARS-13 | ФТ-14 |
| BR-18 | EARS-06 | — |
| BR-19 | EARS-10 | ФТ-15 |
| BR-20 | EARS-11 | ФТ-06 |
| BR-21 | EARS-12 | ФТ-04, ФТ-05 |
| BR-22 | — | ФТ-05, ФТ-15 |
| BR-23 | — | ФТ-27, ФТ-28, ФТ-29 |

BR-14, BR-22 и BR-23 покрыты только классическими ФТ. Их можно добавить в EARS, если преподаватель попросит расширить спецификацию сверх 15 требований.
