# 5. Матрица трассируемости

> Статус: **черновик**. Колонка «Элемент архитектуры» — предварительная: компоненты уточняются в `/speckit.plan` (human-gate G4) и на этапе 2. Финальная версия матрицы — после G5.

## 5.1. Предварительные элементы архитектуры

Деление на контейнеры — в стиле C4 (уровень 2), по лекции 3.

| ID | Компонент | Ответственность |
|---|---|---|
| C-PORTAL | Портал клиента (веб) | Создание заявок, переписка, обратная связь, возобновление |
| C-DESK | Рабочее место инженера и руководителя (веб) | Очередь, карточка заявки, назначение, эскалация, экран утверждения предложений ассистента |
| C-TICKET | Сервис заявок (system of record) | ID, статусы, исполнитель, переписка, правила закрытия и возобновления |
| C-SLA | SLA-сервис | Дедлайны, планировщик таймеров, производственный календарь |
| C-NOTIFY | Сервис уведомлений | Письма (SMTP) и сообщения в Slack по событиям |
| C-BUS | Шина событий | События «заявка создана / ответ опубликован / статус изменён» |
| C-REF | Справочники | Организации и SLA, инженеры (уровень, компетенции), типы, приоритеты, инсталляции |
| C-REPORT | Отчётный модуль | Отчёты ФТ-27…29, расчёт KPI |
| C-AUDIT | Журнал аудита | Неизменяемая история изменений и решений |
| C-AGENT | ИИ-ассистент в harness | Предложения А1–А4, guardrails, журнал tool-calls |
| MCP-TICKETS, MCP-KB, MCP-STAFF | MCP-серверы | Доступ агента к заявкам, базе знаний, данным об инженерах (allow-list из `04-ai-requirements.md`) |

## 5.2. EARS → процесс → архитектура

| EARS | Бизнес-правило | Элемент BPMN | Элемент архитектуры | Принцип constitution |
|---|---|---|---|---|
| EARS-01 | BR-02 | T_Register | C-TICKET | P3 |
| EARS-02 | BR-01, BR-03, BR-04 | T_Submit, T_Register | C-PORTAL, C-TICKET | P3 |
| EARS-03 | BR-07, BR-08 | T_StartSLA | C-SLA, C-REF | P4 |
| EARS-04 | BR-11 | ICE_Warn, T_Warn | C-SLA, C-NOTIFY | P4 |
| EARS-05 | BR-10 | ICE_Breach, T_Breach, EE_Breach | C-SLA, C-NOTIFY, C-AUDIT | P4, P6 |
| EARS-06 | BR-05, BR-09, BR-16, BR-18 | T_RecordResponse, ITE_FirstResp, ICE_FirstResp1/2 | C-TICKET, C-SLA, C-BUS | P4 |
| EARS-07 | BR-12 | T_Notify | C-NOTIFY, C-BUS | P3 |
| EARS-08 | BR-06, BR-13 | T_HeadAssign | C-DESK, C-TICKET, C-AUDIT | P6 |
| EARS-09 | BR-15 | T_Escalate | C-DESK, C-TICKET, C-REF | P6 |
| EARS-10 | BR-19 | BT_3days, GW_CloseNoReply, T_CloseDecision | C-TICKET, C-SLA | P4 |
| EARS-11 | BR-20 | EBG_Reopen, ICE_Reopen, ICE_2weeks | C-PORTAL, C-TICKET | P3 |
| EARS-12 | BR-21 | T_ClientReview, GW_Solved | C-PORTAL, C-TICKET | P3 |
| EARS-13 | BR-17 | GW_Extended, T_RemoteDiag | C-DESK, C-REF | P5 |
| EARS-14 | TO-BE (1.7) | T_AIProposal | C-AGENT, MCP-TICKETS, MCP-KB, MCP-STAFF, C-DESK | P2, P5, P6 |
| EARS-15 | TO-BE (1.7) | T_AIProposal (деградация) | C-AGENT, C-TICKET, C-SLA | P4 |

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
