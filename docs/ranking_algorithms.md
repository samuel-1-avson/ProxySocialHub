# Social Ranking Algorithms

## Provider Score

Score = (
  uptime * 0.3 +
  latency_score * 0.2 +
  bandwidth_score * 0.2 +
  buyer_rating * 0.2 +
  penalty * -0.3
)

---

## Clan Score

ClanScore = avg(provider_scores) * reliability_bonus

---

## Anti-Gaming Measures
- Time-weighted averages
- Outlier suppression
- Abuse penalties

---

## Ranking Windows
- 24h
- 7d
- 30d

