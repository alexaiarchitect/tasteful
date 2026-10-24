# Taste profile (test fixture)

Synthetic profile for tests/rank.test.mjs.

## Weights

```json
{
  "tag_overlap": { "kind": 3, "mood": 2, "extractable": 1 },
  "taste": { "match": 2, "prefer": { "mood": ["minimal","editorial","warm"], "typography.display": ["serif","mixed"], "color.strategy": ["accent-on-neutral","warm-neutral"], "layout.density": ["airy","balanced"] }, "avoid": { "mood": ["corporate"], "color.strategy": ["vivid"] } },
  "anchor_bonus": 3,
  "source_score": 0.5,
  "recency": 1,
  "penalty": { "avoid_conflict": 2, "motion_over_budget": 3, "tentative": 1, "dark_only_when_light_needed": 2 }
}
```

## Feedback log

- (none)
