# Data Model: Обработка обращений в СТП

**Feature**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md) · **Date**: 2026-11-06

Логическая модель данных (основа ER-диаграммы этапа 2). В скобках — требования спецификации.

## Справочники и участники

### Organization — организация-клиент
| Поле | Тип | Правила |
|---|---|---|
| id | идентификатор | |
| name | строка | обязательно, уникально |
| support_type | `standard` \| `extended` | расширенная поддержка — FR-016 |
| sla_hours_type | `business` \| `calendar` | тип часов SLA из договора — FR-007 |
| timezone | IANA-зона | для рабочих часов и календаря |
| business_hours | интервал (например 09:00–18:00) | используется при `business` |

### SlaNorm — норматив первого ответа
| Поле | Тип | Правила |
|---|---|---|
| organization_id | → Organization | |
| priority | `P1`…`P4` | уникально в паре с организацией — FR-005 |
| first_response_hours | целое > 0 | |

### ClientUser — сотрудник организации-клиента (ПДн)
id, organization_id → Organization, full_name, email, is_active. Видит только заявки своей организации (FR-004).

### Engineer — сотрудник СТП
id, full_name, email, level `L1` \| `L2` \| `L3` (FR-015), is_head (руководитель), is_active.
**EngineerCompetence**: engineer_id, product, topic (FR-013).
Загрузка не хранится: число заявок инженера в статусе `waiting_for_support` (ASM-08).

### Справочники
TicketType (4 значения: functionality, configuration, defect, release — ASM-11), Product, Installation (organization_id, product, version, server_label), ProductionCalendar (date, is_working_day).

## Заявка и её жизненный цикл

### Ticket — заявка
| Поле | Тип | Правила |
|---|---|---|
| id | идентификатор | |
| seq_number | целое из последовательности | отображение: `ES-` + номер, дополненный нулями до 4 цифр; после 9999 — без ограничения длины (ES-10000) — FR-002 |
| organization_id, author_id | → Organization, ClientUser | FR-003 |
| subject, description | строка, текст | обязательно |
| type_code | → TicketType | клиент выбирает, инженер может изменить |
| priority | `P1`…`P4` | изменение — только с причиной (FR-014) |
| installation_id | → Installation | инженер может исправить (FR-014) |
| status | `waiting_for_support` \| `waiting_for_customer` \| `closed` | отображаемые названия: «Waiting for support», «Waiting for customer», «Closed» |
| assignee_id | → Engineer, пусто = «Unassigned» | FR-003, FR-010, FR-012 |
| registered_at | время | |
| first_response_due_at | время | рассчитывается при регистрации, не пересчитывается — FR-006 |
| warn_at | время | due − 1 ч; если норматив ≤ 1 ч — = registered_at (ASM-02) |
| warn_sent_at, breach_recorded_at | время, пусто | идемпотентность планировщика — FR-008, FR-009 |
| first_response_at | время, пусто | |
| sla_state | `pending` \| `met` \| `breached` | `breached` не снимается — FR-009 |
| last_engineer_reply_at | время, пусто | отсчёт 3 рабочих дней — FR-018 |
| remote_work_consent_message_id | → TicketMessage, пусто | FR-016 |
| closed_at, close_reason | время; `resolved` \| `no_customer_reply` | FR-018, FR-019 |
| reopen_until | время = closed_at + 14 дней | FR-020 |

### Переходы статусов

| Из | Событие | В | Условие | Требование |
|---|---|---|---|---|
| — | клиент нажал «Send» | waiting_for_support | исполнитель пуст | FR-001, FR-003 |
| waiting_for_support | инженер опубликовал ответ / запрос информации | waiting_for_customer | первый ответ назначает исполнителя, если его нет | FR-010 |
| waiting_for_customer | клиент ответил или «не помогло» | waiting_for_support | исполнитель сохраняется | FR-017 |
| waiting_for_customer | клиент согласился закрыть | closed (`resolved`) | — | FR-019 |
| waiting_for_customer | инженер закрывает «нет ответа» | closed (`no_customer_reply`) | ≥ 3 рабочих дней от last_engineer_reply_at без сообщений клиента | FR-018 |
| closed | клиент возобновил | waiting_for_support | now ≤ reopen_until; исполнитель сохраняется | FR-020 |

Любой другой переход отклоняется с ошибкой «недопустимый переход» и не меняет данных.

### TicketMessage — сообщение в заявке
id, ticket_id, author_kind (`client` \| `engineer`), author_id, kind (`client_message` \| `answer` \| `info_request` \| `priority_justification_request` \| `feedback_resolved` \| `feedback_not_resolved` \| `consent`), body, attachments, created_at, is_first_response (истина только у одного сообщения заявки).

### TicketHistoryEvent — история (неизменяемая, FR-022)
id, ticket_id, event_type (`registered`, `assignee_changed`, `escalated`, `priority_changed`, `installation_changed`, `status_changed`, `sla_warned`, `sla_breached`, `sla_met`, `closed`, `reopened`, `proposal_decided`), old_value, new_value, actor_kind (`client` \| `engineer` \| `system`), actor_id, reason (обязательна для смены исполнителя, эскалации, приоритета), created_at. Обновление и удаление запрещены на уровне прав БД.

## События и уведомления

### OutboxEvent — исходящее событие
id, event_type (см. `contracts/events.md`), ticket_id, payload (JSON), created_at, processed_at, attempts. Пишется в одной транзакции с изменением заявки.

### Notification — отправленное уведомление
id, outbox_event_id, channel (`email` \| `slack`), recipients, status (`sent` \| `failed`), sent_at, error. Для одного события — не более одного письма на получателя и одного сообщения в Slack (EARS-07).

## ИИ-ассистент

### AssistantProposal — предложение ассистента
| Поле | Тип | Правила |
|---|---|---|
| id, ticket_id | | одно действующее предложение на заявку |
| suggested_type | → TicketType | |
| priority_flag | `ok` \| `possibly_higher` \| `possibly_lower` | только флаг, приоритет не меняется |
| suggested_assignee_id | → Engineer | только из прошедших фильтр компетенций и уровня |
| draft_reply | текст | |
| rationale, sources, confidence | текст, список ID, 0–1 | ИИ-05 |
| status | `proposed` \| `approved` \| `edited` \| `rejected` \| `unavailable` | `unavailable` — режим деградации (FR-026) |
| decided_by, decided_at | → Engineer, время | заполняются только человеком (FR-024) |

### AssistantToolCall — журнал вызовов инструментов (FR-027)
id, proposal_id, tool_name, arguments (с маскированными ПДн), allowed (истина/ложь), result_hash, latency_ms, cost, created_at.

### AssistantSettings
enabled (общий выключатель), functions_enabled {A1, A2, A3, A4}, confidence_threshold (по умолчанию 0,6), timeout_seconds (60) — FR-026.

## Связи (для ER-диаграммы)

Organization 1—N ClientUser, SlaNorm, Installation, Ticket · ClientUser 1—N Ticket · Engineer 1—N Ticket (assignee), EngineerCompetence · Ticket 1—N TicketMessage, TicketHistoryEvent, OutboxEvent, AssistantProposal · AssistantProposal 1—N AssistantToolCall · OutboxEvent 1—N Notification.
