# :earth_americas: GDP dashboard template

A simple Streamlit app showing the GDP of different countries in the world.

[![Open in Streamlit](https://static.streamlit.io/badges/streamlit_badge_black_white.svg)](https://gdp-dashboard-template.streamlit.app/)

### How to run it on your own machine

1. Install the requirements

   ```
   $ pip install -r requirements.txt
   ```

2. Run the app

   ```
   $ streamlit run streamlit_app.py
   ```

### API env file (for integrating with other scripts)

This repo includes a safe template at `.env.example`. Copy it to `.env` and fill in values:

```
cp .env.example .env
```

The `.env` file is ignored by git, so you can store **API base URLs / tokens** there without committing secrets.

Example usage from bash/curl:

```
set -a; source .env; set +a
curl -sS "${API_BASE_URL}/health"
curl -sS -H "${API_AUTH_HEADER}: ${API_AUTH_SCHEME} ${API_TOKEN}" "${API_BASE_URL}/api/status"
```
