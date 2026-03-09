# Daily Prediction Market Summary App

Simple web app that fetches and summarizes top daily markets from:
- **Polymarket**
- **Kalshi**

## Run

```bash
npm start
```

Then open `http://localhost:3000`.

## Notes

- `/api/summary` aggregates both data sources and returns normalized markets + highlight bullets.
- If one source is unavailable, the app still renders data from the other source and shows a warning.
