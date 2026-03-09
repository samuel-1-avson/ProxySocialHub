# Dashboard Specifications

This document specifies all analytics dashboards for ProxyHubb.

## Dashboard Inventory

| Dashboard | Audience | Refresh Rate | Data Sources |
|-----------|----------|--------------|--------------|
| Executive Overview | C-Suite | 5 min | All |
| Real-Time Operations | DevOps/SRE | 5 sec | Metrics, Logs |
| Business Intelligence | Product/Marketing | 1 hour | Events, Revenue |
| Provider Analytics | Providers | 5 min | Sessions, Earnings |
| User Analytics | Customer Success | 15 min | User events |
| Security Monitoring | Security Team | Real-time | Audit logs |
| Blockchain Health | Blockchain Team | 1 min | Solana RPC |

---

## 1. Executive Overview

**URL**: `/analytics/executive`
**Audience**: CEO, CTO, Board Members
**Purpose**: High-level business health metrics

### Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ EXECUTIVE OVERVIEW                          [Date Range: Last 30 Days]      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   Revenue   │  │ Active Users│  │  Sessions   │  │   Growth    │        │
│  │   $123.5K   │  │   1,234     │  │   45.2K     │  │   +23%      │        │
│  │   ▲ 12%     │  │   ▲ 8%      │  │   ▲ 15%     │  │   vs last   │        │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Revenue Trend (Line Chart)                        │   │
│  │                                                                     │   │
│  │    $                                                                │   │
│  │  150K ┤                                    ╭──╮                     │   │
│  │  100K ┤                  ╭────╮      ╭────╯  │                     │   │
│  │   50K ┤    ╭────╮   ╭────╯    ╰──────╯         │                     │   │
│  │    0K ┼────╯    ╰───╯                             │                     │   │
│  │       └────┬────┬────┬────┬────┬────┬────┬────┬                    │   │
│  │            W1   W2   W3   W4   W5   W6   W7   W8                   │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────┐  ┌─────────────────────────────────────────┐  │
│  │   Revenue by Region     │  │        Top Providers by Revenue         │  │
│  │                         │  │                                         │  │
│  │    [Pie Chart]          │  │  1. Provider A    $45.2K    ▲ 15%      │  │
│  │                         │  │  2. Provider B    $38.1K    ▲ 8%       │  │
│  │  US: 45%                │  │  3. Provider C    $29.7K    ▼ 3%       │  │
│  │  EU: 30%                │  │  4. Provider D    $22.4K    ▲ 22%      │  │
│  │  APAC: 20%              │  │  5. Provider E    $18.9K    ▲ 12%      │  │
│  │  Other: 5%              │  │                                         │  │
│  └─────────────────────────┘  └─────────────────────────────────────────┘  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      Key Metrics Table                               │   │
│  ├──────────────────┬────────────┬────────────┬────────────┬───────────┤   │
│  │ Metric           │ This Month │ Last Month │   Change   │   Trend   │   │
│  ├──────────────────┼────────────┼────────────┼────────────┼───────────┤   │
│  │ New Users        │    1,234   │    1,100   │   +12.2%   │     📈    │   │
│  │ Avg Order Value  │    $45.20  │    $42.10  │    +7.4%   │     📈    │   │
│  │ Churn Rate       │     2.3%   │     2.8%   │   -17.9%   │     📉    │   │
│  │ NPS Score        │     72     │     68     │    +5.9%   │     📈    │   │
│  │ Bandwidth Sold   │   45.2 TB  │   38.5 TB  │   +17.4%   │     📈    │   │
│  └──────────────────┴────────────┴────────────┴────────────┴───────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Metrics

| Metric | Definition | Source | Calculation |
|--------|------------|--------|-------------|
| Revenue | Total fees collected | escrow_transactions | SUM(amount * fee_rate) |
| Active Users | Unique users with activity | user_events | COUNT(DISTINCT user_id) |
| Sessions | Proxy sessions created | sessions | COUNT(*) |
| Growth | Month-over-month growth | revenue | (current - previous) / previous |
| Churn Rate | Users who didn't return | user_events | churned / total_users |

---

## 2. Real-Time Operations

**URL**: `/analytics/operations`
**Audience**: DevOps, SRE, Platform Team
**Purpose**: System health and performance monitoring

### Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ REAL-TIME OPERATIONS                        [Auto-Refresh: 5s] [Alerts: 3]  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         System Health                                │   │
│  ├───────────────┬───────────────┬───────────────┬───────────────────────┤   │
│  │  API          │  Gateway      │  Database     │  Blockchain           │   │
│  │  🟢 Healthy   │  🟢 Healthy   │  🟡 Warning   │  🟢 Healthy           │   │
│  │  Latency: 45ms│  Latency: 12ms│  Conn: 85%    │  Conf: 400ms          │   │
│  └───────────────┴───────────────┴───────────────┴───────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Request Rate (Live)                               │   │
│  │                                                                     │   │
│  │   10K ┤                                    ┌───┐                     │   │
│  │    8K ┤            ┌───┐     ┌───┐        │   │  ┌───┐              │   │
│  │    6K ┤   ┌───┐    │   │     │   │  ┌───┐ │   │  │   │              │   │
│  │    4K ┤   │   │    │   │     │   │  │   │ │   │  │   │              │   │
│  │    2K ┤   │   │    │   │     │   │  │   │ │   │  │   │              │   │
│  │    0K ┼───┴───┴────┴───┴─────┴───┴──┴───┴─┴───┴──┴───┴───►         │   │
│  │       -5m  -4m  -3m  -2m  -1m  now                                 │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌──────────────────────────┐  ┌─────────────────────────────────────────┐  │
│  │    Error Rate by Service │  │           Top Error Types               │  │
│  │                          │  │                                         │  │
│  │   API:      0.1%  🟢     │  │  1. Database Timeout     23    45%     │  │
│  │   Gateway:  0.05% 🟢     │  │  2. Rate Limited         18    35%     │  │
│  │   Web:      0.3%  🟢     │  │  3. Auth Failed          8     16%     │  │
│  │   Solana:   2.1%  🟡     │  │  4. Validation Error     2      4%     │  │
│  │                          │  │                                         │  │
│  └──────────────────────────┘  └─────────────────────────────────────────┘  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Resource Utilization                              │   │
│  │                                                                     │   │
│  │   API Pods:     [████████░░░░░░░░░░] 45%    (3/10)                 │   │
│  │   Gateway Pods: [████████████░░░░░░] 65%    (7/10)                 │   │
│  │   DB CPU:       [████████████████░░] 85%    ⚠️                     │   │
│  │   Redis Memory: [██████████████░░░░] 75%    (7.5/10 GB)            │   │
│  │   Disk I/O:     [████████░░░░░░░░░░] 42%                           │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Recent Alerts                                     │   │
│  ├────────────────────┬────────────┬────────┬──────────────────────────┤   │
│  │ Alert              │ Time       │ Status │ Action                   │   │
│  ├────────────────────┼────────────┼────────┼──────────────────────────┤   │
│  │ High DB Latency    │ 2 min ago  │ Active │ Investigating            │   │
│  │ Rate Limit Hit     │ 5 min ago  │ Cleared│ -                        │   │
│  │ Memory Warning     │ 15 min ago │ Cleared│ -                        │   │   │
│  └────────────────────┴────────────┴────────┴──────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Metrics

| Metric | Alert Threshold | Critical Threshold |
|--------|-----------------|-------------------|
| API Latency (p99) | > 500ms | > 2000ms |
| Error Rate | > 1% | > 5% |
| DB Connections | > 80% | > 95% |
| Memory Usage | > 80% | > 95% |
| Solana Confirmation | > 2s | > 10s |

---

## 3. Business Intelligence

**URL**: `/analytics/business`
**Audience**: Product, Marketing, Growth
**Purpose**: User behavior and business metrics

### Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ BUSINESS INTELLIGENCE                       [Segment: All Users]            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    User Funnel                                       │   │
│  │                                                                     │   │
│  │   Signup      KYC      Deposit    First Session    Retention        │   │
│  │   ┌─────┐    ┌─────┐   ┌─────┐    ┌─────┐        ┌─────┐           │   │
│  │   │100% │───▶│ 75% │──▶│ 45% │───▶│ 30% │───────▶│ 20% │           │   │
│  │   │1,234│    │ 926 │   │ 555 │    │ 370 │        │ 247 │           │   │
│  │   └─────┘    └─────┘   └─────┘    └─────┘        └─────┘           │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌──────────────────────────┐  ┌─────────────────────────────────────────┐  │
│  │      Cohort Retention    │  │           User Acquisition              │  │
│  │                          │  │                                         │  │
│  │      W1   W2   W3   W4   │  │    [Bar Chart: Users by Channel]       │  │
│  │  Jan 100%  80%  65%  55%  │  │                                         │  │
│  │  Feb 100%  85%  70%  60%  │  │  Organic: ████████████████████ 45%    │  │
│  │  Mar 100%  82%  68%  -    │  │  Paid:    ████████████ 30%             │  │
│  │  Apr 100%  88%  -   -    │  │  Social:  ████████ 15%                 │  │
│  │  May 100%  -   -   -    │  │  Referral: ████ 10%                    │  │
│  │                          │  │                                         │  │
│  └──────────────────────────┘  └─────────────────────────────────────────┘  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Revenue Attribution                               │   │
│  │                                                                     │   │
│  │   ┌──────────────┐  ┌──────────────┐  ┌──────────────┐             │   │
│  │   │  By Country  │  │  By Device   │  │   By Plan    │             │   │
│  │   │              │  │              │  │              │             │   │
│  │   │ US: $45K     │  │ Desktop: 60% │  │ Basic: $25K  │             │   │
│  │   │ UK: $20K     │  │ Mobile: 35%  │  │ Pro: $65K    │             │   │
│  │   │ DE: $15K     │  │ Tablet: 5%   │  │ Ent: $33K    │             │   │
│  │   └──────────────┘  └──────────────┘  └──────────────┘             │   │
│  │                                                                     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Provider Analytics

**URL**: `/dashboard/provider`
**Audience**: Proxy Providers
**Purpose**: Provider earnings and performance

### Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ PROVIDER DASHBOARD                          [Provider: Provider_A]          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   Earnings  │  │  Sessions   │  │   Rating    │  │    Uptime   │        │
│  │   $4,521.50 │  │    234      │  │    4.8 ★    │  │   99.9%     │        │
│  │   This Month│  │   This Month│  │   (47 rev)  │  │             │        │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘        │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Earnings Trend                                    │   │
│  │                                                                     │   │
│  │   $5K ┤                                                      ╭────  │   │
│  │   $4K ┤                              ╭────────╮      ╭──────╯      │   │
│  │   $3K ┤            ╭────╮     ╭──────╯        ╰──────╯             │   │
│  │   $2K ┤   ╭────╮   │    │     │                                     │   │
│  │   $1K ┤   │    │   │    │     │                                     │   │
│  │    $0 ┼───┴────┴───┴────┴─────┴────────────────────────────────►   │   │
│  │       Week 1  Week 2  Week 3  Week 4                               │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
│  ┌──────────────────────────┐  ┌─────────────────────────────────────────┐  │
│  │    Performance Metrics   │  │           Session Details               │  │
│  │                          │  │                                         │  │
│  │  Avg Latency: 45ms  🟢   │  │  Total Bandwidth: 2.4 TB               │  │
│  │  Success Rate: 99.5% 🟢  │  │  Avg Session: 45 minutes               │  │
│  │  Peak Speed: 100 Mbps    │  │  Unique Users: 156                     │  │
│  │  Locations: 12 countries │  │  Top Country: US (45%)                 │  │
│  │                          │  │                                         │  │
│  │  [Quality Score: 94/100] │  │  [View Detailed Logs]                  │  │
│  └──────────────────────────┘  └─────────────────────────────────────────┘  │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    Recent Reviews                                    │   │
│  ├────────────────────┬────────┬────────────────────────────────────────┤   │
│  │ User               │ Rating │ Comment                                │   │
│  ├────────────────────┼────────┼────────────────────────────────────────┤   │
│  │ user_123           │ ★★★★★  │ "Excellent speed and reliability!"     │   │
│  │ user_456           │ ★★★★☆  │ "Great service, occasional drops"      │   │
│  │ user_789           │ ★★★★★  │ "Best provider I've used"              │   │
│  └────────────────────┴────────┴────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. User Analytics

**URL**: `/analytics/users`
**Audience**: Customer Success, Support
**Purpose**: Individual user insights

### Features
- User activity timeline
- Session history
- Payment history
- Support tickets
- Feature usage

---

## 6. Security Monitoring

**URL**: `/analytics/security`
**Audience**: Security Team
**Purpose**: Security events and anomalies

### Features
- Failed login attempts
- Suspicious transactions
- API abuse patterns
- Geographic anomalies
- Audit log viewer

---

## 7. Blockchain Health

**URL**: `/analytics/blockchain`
**Audience**: Blockchain Team
**Purpose**: Solana integration health

### Features
- Transaction confirmation times
- Oracle health
- Treasury balance
- Program upgrades
- Gas costs

---

## Implementation

### Tech Stack

| Component | Technology |
|-----------|------------|
| Dashboard Engine | Grafana / Custom React |
| Query Engine | ClickHouse / GraphQL |
| Real-Time | WebSocket / SSE |
| Caching | Redis |
| Export | CSV / PDF / PNG |

### API Endpoints

```
GET /api/v1/analytics/dashboards - List dashboards
GET /api/v1/analytics/dashboards/:id - Get dashboard
GET /api/v1/analytics/metrics - Query metrics
POST /api/v1/analytics/export - Export data
GET /api/v1/analytics/realtime - Real-time stream
```

### Permissions

| Dashboard | Admin | Provider | User |
|-----------|-------|----------|------|
| Executive | ✅ | ❌ | ❌ |
| Operations | ✅ | ❌ | ❌ |
| Business | ✅ | ❌ | ❌ |
| Provider | ✅ | Own data | ❌ |
| User | ✅ | ❌ | Own data |
| Security | ✅ | ❌ | ❌ |
| Blockchain | ✅ | ❌ | ❌ |

---

Last updated: 2026-03-09
