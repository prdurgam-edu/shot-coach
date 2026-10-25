#!/usr/bin/env bash
# Deploys the Shot Coach server to Cloud Run. Run it in Google Cloud Shell (already signed in) or anywhere gcloud is set up.
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT="${GOOGLE_CLOUD_PROJECT:-$(gcloud config get-value project 2>/dev/null || true)}"
if [ -z "$PROJECT" ] || [ "$PROJECT" = "(unset)" ]; then
  echo "No Google Cloud project is selected."
  echo "List your projects with:  gcloud projects list"
  echo "Then run:                 gcloud config set project YOUR_PROJECT_ID   and run this script again."
  exit 1
fi
REGION="${REGION:-asia-south1}"
echo "Project: $PROJECT   Region: $REGION"
echo "Billing must be turned on for this project."
echo

read -r -s -p "Paste your Gemini API key (from aistudio.google.com/apikey, hidden): " GEMINI_KEY; echo
read -r -s -p "Choose an access code for the app, at least 12 characters (hidden): " CODE; echo
if [ -z "$GEMINI_KEY" ] || [ "${#CODE}" -lt 12 ]; then echo "Both are required, and the code needs 12 or more characters."; exit 1; fi

gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --project "$PROJECT"
gcloud run deploy shot-coach-api --project "$PROJECT" --region "$REGION" --source server \
  --allow-unauthenticated --quiet \
  --set-env-vars "API_KEY=$CODE,GEMINI_API_KEY=$GEMINI_KEY"

URL="$(gcloud run services describe shot-coach-api --project "$PROJECT" --region "$REGION" --format 'value(status.url)')"
echo
echo "Server address for the app: $URL"
echo "Quick check (should print ok):  curl -s $URL/health"
