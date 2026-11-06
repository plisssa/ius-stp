# Контракт событий (C-BUS)

События записываются в таблицу `outbox` в той же транзакции, что и изменение заявки, и доставляются подписчикам фоновым обработчиком не менее одного раза. Подписчики обязаны быть идемпотентными (ключ — `event_id`).

Общие поля каждого события: `event_id`, `event_type`, `occurred_at`, `ticket_number`, `organization_id`, `actor` (`client` / `engineer` / `system` + id).

| Событие | Когда | Доп. поля | Подписчики | Требование |
|---|---|---|---|---|
| `ticket.registered` | клиент нажал «Send» | priority, type_code, first_response_due_at | уведомления, ассистент | FR-001, FR-011, FR-023 |
| `ticket.updated` | новое сообщение, смена приоритета, инсталляции, исполнителя | changed_fields | уведомления | FR-011 |
| `ticket.status_changed` | любая смена статуса | old_status, new_status, close_reason | уведомления | FR-011 |
| `ticket.first_response_published` | первый ответ инженера | engineer_id, sla_state (`met` / `breached`) | — (фиксирует SLA в ядре) | FR-010 |
| `sla.warning_due` | наступил warn_at без первого ответа | first_response_due_at | уведомления (все инженеры) | FR-008 |
| `sla.breached` | наступил due_at без первого ответа | first_response_due_at | уведомления (все инженеры + руководитель) | FR-009 |
| `ticket.escalated` | эскалация | from_engineer_id, to_engineer_id, reason | уведомления | FR-015 |
| `ticket.reopened` | клиент возобновил | — | уведомления | FR-020 |
| `assistant.proposal_ready` | ассистент сохранил предложение | proposal_id, status | рабочее место (обновление карточки) | FR-023 |
| `assistant.proposal_decided` | человек утвердил, изменил или отклонил | proposal_id, action, decided_by | журнал, метрики ИИ-10 | FR-024, FR-027 |

Правила:
- `sla.warning_due` и `sla.breached` порождает только планировщик SLA ядра; ассистент таких событий не порождает и не получает права их отменять (P4).
- Канал Slack получает сводку события; почта — отдельное письмо с деталями (BR-12).
