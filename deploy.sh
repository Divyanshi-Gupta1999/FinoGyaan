#!/bin/bash
# ===================================================
# FinWise AI — Google Cloud Run Deployment Script
# ===================================================

set -euo pipefail

PROJECT_ID="finwise-506509"
REGION="us-central1"
SERVICE_NAME="finwise-app"

echo "=============================================="
echo "  Deploying FinWise AI to Google Cloud Run"
echo "  Project: ${PROJECT_ID}"
echo "  Region:  ${REGION}"
echo "  Service: ${SERVICE_NAME}"
echo "=============================================="

# 1. Build frontend bundle locally first to ensure no build regressions
echo ""
echo "[1/3] Validating frontend production build..."
npm run build --prefix frontend

# 2. Deploy directly using Cloud Build & Cloud Run
echo ""
echo "[2/3] Building container image and deploying to Cloud Run..."
gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --platform=managed \
  --allow-unauthenticated \
  --port=8080 \
  --memory=1Gi \
  --cpu=1 \
  --min-instances=0 \
  --max-instances=10 \
  --set-env-vars="NODE_ENV=production,GOOGLE_CLOUD_PROJECT=${PROJECT_ID},GOOGLE_CLOUD_LOCATION=global,PROXY_HEADER=olsvpAa7bsvcult5KJbg8D_homx6JY-g,API_BACKEND_HOST=0.0.0.0" \
  --quiet

# 3. Fetch Service URL & Health Check
echo ""
echo "[3/3] Fetching deployed service URL..."
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format="value(status.url)")

echo "=============================================="
echo "  Deployment Successful!"
echo "  Primary URL (Firebase):  https://${PROJECT_ID}.web.app"
echo "  Backup URL (Firebase):   https://${PROJECT_ID}.firebaseapp.com"
echo "  Direct Cloud Run URL:    ${SERVICE_URL}"
echo "=============================================="
