# Implementation Plan: Обработка обращений в службу технической поддержки (СТП)

**Branch**: `stage1/speckit` (feature `001-stp-ticket-processing`) | **Date**: 2026-11-06 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-stp-ticket-processing/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command; its definition describes the execution workflow.

## Summary

Система регистрирует заявки клиентов, детерминированно контролирует SLA первого ответа, рассылает уведомления на почту и в Slack, поддерживает назначение, эскалацию, закрытие и возобновление по правилам кейса и строит три отчёта. ИИ-ассистент работает отдельным процессом и только готовит предложения, доступ к данным получает через MCP-серверы с allow-list; решения применяет человек.

Технический подход: модульный монолит на Python и FastAPI с PostgreSQL. Дедлайны SLA хранятся в БД и обрабатываются фоновым планировщиком. События между модулями передаются через transactional outbox. Интерфейс — серверные шаблоны. Обоснование решений — в [research.md](./research.md).

## Technical Context

**Language/Version**: Python 3.12

**Primary Dependencies**: FastAPI, Pydantic v2, SQLAlchemy 2.0, Alembic, Jinja2 + HTMX (интерфейс), официальный Python SDK протокола MCP (серверы и клиент ассистента), провайдер-независимый клиент языковой модели (R9)

**Storage**: PostgreSQL 16 (ядро, история в отдельной схеме с запретом изменений, outbox, журнал ассистента)

**Testing**: pytest, httpx-клиент FastAPI, подмена времени (time-machine), контрактные тесты против `contracts/http-api.yaml`, набор тестов на prompt injection

**Target Platform**: Linux-сервер, контейнеры Docker Compose (app, worker, postgres, assistant, mcp-tickets, mcp-kb, mcp-staff; в прототипе — Mailpit и заглушка Slack)

**Project Type**: web-service с серверным веб-интерфейсом и отдельными процессами ИИ-ассистента и MCP-серверов

**Performance Goals**: регистрация заявки ≤ 2 с, открытие карточки ≤ 1,5 с (95-й перцентиль); годовой отчёт ≤ 10 с; уведомление ≤ 1 мин после события; предложение ассистента ≤ 60 с (НФТ-03, НФТ-04, FR-023)

**Constraints**: погрешность SLA-событий ≤ 1 мин, в том числе после перезапуска (НФТ-02); доступность ≥ 99,5 % в месяц, RTO ≤ 2 ч, RPO ≤ 5 мин (НФТ-01 — класс уточняется на G2, см. R13); ПДн хранятся в РФ и маскируются перед передачей в модель (НФТ-09); ассистент не влияет на ядро (P4)

**Scale/Scope**: до 500 заявок в сутки, 100 одновременных пользователей (допущение НФТ-05); 3 роли сотрудников и клиенты; около 15 экранов (портал, рабочее место, отчёты, администрирование)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Принцип | Проверка до фазы 0 | После фазы 1 (дизайн) |
|---|---|---|
| P1. Спецификация — единый источник истины | ✅ План выводится из `spec.md`; каждое решение в research ссылается на FR/НФТ | ✅ Контракты и модель данных ссылаются на FR; `tasks.md` будет ссылаться на требования |
| P2. Модель предлагает · ядро исполняет · человек утверждает | ✅ Ассистент пишет только в предложения | ✅ `proposal.save` — единственная запись; применение — только `POST …/proposal/decision` (contracts) |
| P3. Предметная область неизменна | ✅ Статусы, роли, отчёты — из кейса; решения ASM-05/07/09 приняты на G3 | ✅ Статусы в модели данных совпадают с кейсом; SLA на решение не вводится |
| P4. Детерминированный SLA-контур | ✅ SLA рассчитывается в ядре, без модели | ✅ Дедлайн хранится; планировщик идемпотентен; события SLA порождает только ядро (events.md); сценарий Q15 |
| P5. Zero trust для агента | ✅ Доступ только через MCP | ✅ Allow-list на стороне сервера, роли БД «только чтение», недоверенный текст, маскирование ПДн (R10, mcp-tools.md); сценарий Q16 |
| P6. Наблюдаемость и аудит | ✅ История, журнал агента | ✅ TicketHistoryEvent без права изменения, AssistantToolCall, метрики (R14) |
| P7. Проверяемость и трассируемость | ✅ Критерии приёмки EARS — основа тестов | ✅ Сценарии quickstart Q1–Q16 ссылаются на FR; соответствие C-* → модули — ниже |

**Результат**: нарушений нет, обоснования сложности не требуются. Открытый вопрос G2 (класс критичности и RPO) влияет только на конфигурацию резервного копирования.

## Project Structure

### Documentation (this feature)

```text
specs/001-stp-ticket-processing/
├── spec.md              # спецификация (G3 пройден)
├── plan.md              # этот файл
├── research.md          # фаза 0: решения R1–R14
├── data-model.md        # фаза 1: сущности, переходы статусов
├── quickstart.md        # фаза 1: сценарии проверки Q1–Q16
├── contracts/
│   ├── http-api.yaml    # OpenAPI 3.1: портал, рабочее место, отчёты, администрирование
│   ├── events.md        # события outbox
│   └── mcp-tools.md     # allow-list инструментов ассистента
├── checklists/
│   └── requirements.md  # чек-лист качества спецификации
└── tasks.md             # создаётся /speckit-tasks
```

### Source Code (repository root)

```text
src/stp/
├── app.py                 # сборка FastAPI-приложения
├── core/                  # конфигурация, БД, часы (подменяемые), безопасность
├── tickets/               # C-TICKET: заявка, статусы, номера ES-NNNN, сообщения
├── sla/                   # C-SLA: нормативы, календарь, расчёт дедлайнов, планировщик
├── notify/                # C-NOTIFY: адаптеры почты и Slack
├── events/                # C-BUS: outbox и диспетчер
├── refdata/               # C-REF: организации, инженеры, справочники
├── reports/               # C-REPORT: три отчёта
├── audit/                 # C-AUDIT: история изменений
├── portal/                # C-PORTAL: маршруты и шаблоны портала клиента
├── desk/                  # C-DESK: очередь, карточка, назначение, экран предложения
├── admin/                 # настройки ассистента и SLA
├── worker.py              # фоновый процесс: планировщик SLA + диспетчер outbox
└── seed.py                # тестовые данные для quickstart

assistant/                 # C-AGENT: harness, схемы вывода, маскирование ПДн, клиент MCP
mcp_servers/
├── tickets/               # MCP-TICKETS
├── kb/                    # MCP-KB
└── staff/                 # MCP-STAFF

migrations/                # Alembic
tests/
├── unit/                  # расчёт дедлайнов, календарь, переходы статусов, формат номеров
├── contract/              # ответы API против contracts/http-api.yaml
├── integration/           # сценарии Q1–Q15
└── security/              # prompt injection (Q16), доступ к чужим заявкам (Q2)

docker-compose.yml
```

**Structure Decision**: модульный монолит `src/stp/` (один деплой app + worker) и отдельные процессы `assistant/` и `mcp_servers/` — чтобы отказ или компрометация ИИ-контура не затрагивали ядро (P4, P5). Модули ядра соответствуют контейнерам C4 из `docs/05-traceability.md`:

| Компонент (docs/05) | Где в коде |
|---|---|
| C-PORTAL | `src/stp/portal/` |
| C-DESK | `src/stp/desk/` |
| C-TICKET | `src/stp/tickets/` |
| C-SLA | `src/stp/sla/`, `src/stp/worker.py` |
| C-NOTIFY | `src/stp/notify/` |
| C-BUS | `src/stp/events/` (outbox) |
| C-REF | `src/stp/refdata/` |
| C-REPORT | `src/stp/reports/` |
| C-AUDIT | `src/stp/audit/` |
| C-AGENT | `assistant/` |
| MCP-TICKETS, MCP-KB, MCP-STAFF | `mcp_servers/tickets/`, `kb/`, `staff/` |

## Complexity Tracking

Нарушений конституции нет — таблица не заполняется.
