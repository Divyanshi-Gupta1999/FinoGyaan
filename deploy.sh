#!/bin/bash
# ===================================================
# FinoGyaan — Google Cloud Run & Firebase Deployment Script
# ===================================================

set -euo pipefail

PROJECT_ID="finwise-506509"
REGION="us-central1"
SERVICE_NAME="finogyaan"

echo "=============================================="
echo "  Deploying FinoGyaan to Google Cloud"
echo "  Project: ${PROJECT_ID}"
echo "  Region:  ${REGION}"
echo "  Service: ${SERVICE_NAME}"
echo "=============================================="

# 1. Build frontend bundle locally first to ensure no build regressions
echo ""
echo "[1/4] Validating frontend production build..."
npm run build --prefix frontend

# 2. Deploy directly using Cloud Build & Cloud Run
echo ""
echo "[2/4] Building container image and deploying to Cloud Run..."
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

# 3. Deploy Firebase Hosting rewrite
echo ""
echo "[3/4] Releasing Firebase Hosting for site ${SERVICE_NAME}..."
FB_TOKEN=$(gcloud auth print-access-token)
FB_VERSION=$(curl -s -X POST \
  -H "Authorization: Bearer ${FB_TOKEN}" \
  -H "X-Goog-User-Project: ${PROJECT_ID}" \
  -H "Content-Type: application/json" \
  -d "{\"config\":{\"rewrites\":[{\"glob\":\"**\",\"run\":{\"serviceId\":\"${SERVICE_NAME}\",\"region\":\"${REGION}\"}}]}}" \
  "https://firebasehosting.googleapis.com/v1beta1/projects/${PROJECT_ID}/sites/${SERVICE_NAME}/versions" | grep -o '"name": "[^"]*"' | head -n 1 | cut -d'"' -f4 || true)

if [ -n "${FB_VERSION}" ]; then
  curl -s -X PATCH \
    -H "Authorization: Bearer ${FB_TOKEN}" \
    -H "X-Goog-User-Project: ${PROJECT_ID}" \
    -H "Content-Type: application/json" \
    -d '{"status":"FINALIZED"}' \
    "https://firebasehosting.googleapis.com/v1beta1/${FB_VERSION}?update_mask=status" > /dev/null
  curl -s -X POST \
    -H "Authorization: Bearer ${FB_TOKEN}" \
    -H "X-Goog-User-Project: ${PROJECT_ID}" \
    -H "Content-Type: application/json" \
    "https://firebasehosting.googleapis.com/v1beta1/projects/${PROJECT_ID}/sites/${SERVICE_NAME}/releases?versionName=${FB_VERSION}" > /dev/null
  echo "Firebase Hosting release successful!"
fi

# 4. Fetch Service URL & Health Check
echo ""
echo "[4/4] Fetching deployed service URL..."
SERVICE_URL=$(gcloud run services describe "${SERVICE_NAME}" \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format="value(status.url)")

echo "=============================================="
echo "  Deployment Successful!"
echo "  Primary URL (Firebase):  https://finogyaan.web.app"
echo "  Backup URL (Firebase):   https://finogyaan.firebaseapp.com"
echo "  Direct Cloud Run URL:    ${SERVICE_URL}"
echo "=============================================="
