# Example datasets

## scrum-team-demo.tsv

420 tickets from a fictional scrum team across 14 sprints — file order is chronological, so **rainbow-by-row-order = time**. Columns:

| Column | Type | Notes |
|---|---|---|
| ticket | label | TCKT-0001 … |
| type | category | Feature / Bug / Chore / Spike — try **color-by** and **facets** |
| hero | category | who took the ticket; heroes have different speed/fun profiles |
| component | category | frontend / backend / infra / data |
| sprint | numeric | 1–14, chronological |
| story_points | numeric | Fibonacci; correlates with diff_size and days_open |
| days_open | numeric | log-normal-ish, a few zombie-ticket outliers (log scale helps) |
| diff_size | numeric | lines changed; bugs run smaller, spikes near zero |
| review_comments | numeric | scales with diff size (one hero attracts extra comments) |
| times_reopened | numeric | mostly 0; bug-heavy |
| cost_gbp | numeric | ≈ days x rate + diff overhead; **blank for some spikes** (untracked) |
| coffee_cups | numeric | tracks days_open (one hero drinks double) |
| fun_factor | numeric | 0–10; **~8% blank** (retro form not filled in) — sparse-column handling on display |

Demo it live (loads straight from this repo):

**https://dbolser.github.io/Demonstrable-Plotalizer/?data=https://raw.githubusercontent.com/dbolser/Demonstrable-Plotalizer/main/examples/scrum-team-demo.tsv**

Things to show off: color-by `type` with stacked histograms; facet to just `Bug`s; rainbow-by-column-rank on `days_open` (click its diagonal label in rainbow mode); reference line + correlation badges on `days_open` × `cost_gbp` (strong r); PCA columns; brush the zombie tickets and watch the data table.
