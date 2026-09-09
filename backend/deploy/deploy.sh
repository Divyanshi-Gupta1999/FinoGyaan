#!/bin/bash
#
# FinWise AI — Deploy Daily Ingestion Pipeline
# ==============================================
# Deploys:
#   1. Cloud Function (2nd gen) — finwise-daily-ingest
#   2. Cloud Scheduler job — triggers the function at 1:30 AM UTC weekdays
#
# Prerequisites:
#   - gcloud CLI authenticated with project finwise-506509
#   - BigQuery API enabled
#   - Cloud Functions API enabled
#   - Cloud Scheduler API enabled
#   - Service account with BigQuery Data Editor + BigQuery Job User roles
#
# Usage:
#   chmod +x deploy/deploy.sh
#   ./deploy/deploy.sh

set -euo pipefail

PROJECT_ID="finwise-506509"
REGION="us-central1"
FUNCTION_NAME="finwise-daily-ingest"
SCHEDULER_JOB_NAME="finwise-daily-ingest-job"
SCHEDULE="30 1 * * 1-5"  # 1:30 AM UTC, Mon-Fri (7:00 AM IST / 9:30 PM ET prev day)
RUNTIME="python311"
TIMEOUT="540s"        # 9 minutes (max for 2nd gen)
MEMORY="1Gi"
SERVICE_ACCOUNT=""    # Leave empty to use default compute SA

echo "=============================================="
echo "  FinWise AI — Pipeline Deployment"
echo "  Project: ${PROJECT_ID}"
echo "  Region: ${REGION}"
echo "=============================================="

# --- Step 1: Enable required APIs ---
echo ""
echo "[1/4] Enabling required GCP APIs..."
gcloud services enable \
  cloudfunctions.googleapis.com \
  cloudscheduler.googleapis.com \
  bigquery.googleapis.com \
  cloudbuild.googleapis.com \
  cloudresourcemanager.googleapis.com \
  --project="${PROJECT_ID}" --quiet

# --- Step 2: Deploy Cloud Function ---
echo ""
echo "[2/4] Deploying Cloud Function: ${FUNCTION_NAME}..."

# Copy pipeline modules alongside Cloud Function source
DEPLOY_DIR=$(mktemp -d)
cp -r "$(dirname "$0")/cloud_function/"* "${DEPLOY_DIR}/"
cp -r "$(dirname "$0")/../pipelines" "${DEPLOY_DIR}/pipelines/"
cp "$(dirname "$0")/../ingest_stocks.py" "${DEPLOY_DIR}/"
cp "$(dirname "$0")/../ingest_macro.py" "${DEPLOY_DIR}/"

EXTRA_FLAGS=""
if [ -n "${SERVICE_ACCOUNT}" ]; then
  EXTRA_FLAGS="--service-account=${SERVICE_ACCOUNT}"
fi

gcloud functions deploy "${FUNCTION_NAME}" \
  --gen2 \
  --runtime="${RUNTIME}" \
  --region="${REGION}" \
  --source="${DEPLOY_DIR}" \
  --entry-point="daily_ingest" \
  --trigger-http \
  --timeout="${TIMEOUT}" \
  --memory="${MEMORY}" \
  --no-allow-unauthenticated \
  --project="${PROJECT_ID}" \
  ${EXTRA_FLAGS} \
  --quiet

# Get the function URL
FUNCTION_URL=$(gcloud functions describe "${FUNCTION_NAME}" \
  --gen2 \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format="value(serviceConfig.uri)")

echo "  Function deployed at: ${FUNCTION_URL}"

# Cleanup temp dir
# Grant Cloud Scheduler service account permission to invoke the function
echo "  Granting run.invoker role to ${PROJECT_ID}@appspot.gserviceaccount.com..."
gcloud run services add-iam-policy-binding "${FUNCTION_NAME}" \
  --region="${REGION}" \
  --member="serviceAccount:${PROJECT_ID}@appspot.gserviceaccount.com" \
  --role="roles/run.invoker" \
  --project="${PROJECT_ID}" \
  --quiet

# --- Step 3: Create/Update Cloud Scheduler Job ---
echo ""
echo "[3/4] Creating Cloud Scheduler job: ${SCHEDULER_JOB_NAME}..."
echo "  Schedule: ${SCHEDULE} (1:30 AM UTC, Mon-Fri)"

# Delete existing job if it exists (ignore errors)
gcloud scheduler jobs delete "${SCHEDULER_JOB_NAME}" \
  --location="${REGION}" \
  --project="${PROJECT_ID}" \
  --quiet 2>/dev/null || true

gcloud scheduler jobs create http "${SCHEDULER_JOB_NAME}" \
  --location="${REGION}" \
  --schedule="${SCHEDULE}" \
  --uri="${FUNCTION_URL}" \
  --http-method=GET \
  --oidc-service-account-email="${PROJECT_ID}@appspot.gserviceaccount.com" \
  --time-zone="UTC" \
  --attempt-deadline="540s" \
  --project="${PROJECT_ID}" \
  --quiet

# --- Step 4: Verify ---
echo ""
echo "[4/4] Verification..."
echo "  Cloud Function:"
gcloud functions describe "${FUNCTION_NAME}" \
  --gen2 \
  --region="${REGION}" \
  --project="${PROJECT_ID}" \
  --format="table(name, state, serviceConfig.uri)"

echo ""
echo "  Cloud Scheduler:"
gcloud scheduler jobs describe "${SCHEDULER_JOB_NAME}" \
  --location="${REGION}" \
  --project="${PROJECT_ID}" \
  --format="table(name, schedule, state, httpTarget.uri)"

echo ""
echo "=============================================="
echo "  Deployment Complete!"
echo ""
echo "  Test manually:"
echo "    gcloud functions call ${FUNCTION_NAME} --gen2 --region=${REGION} --data='{}'"
echo ""
echo "  Dry-run test:"
echo "    curl \"${FUNCTION_URL}?dry-run=true\" -H \"Authorization: bearer \$(gcloud auth print-identity-token)\""
echo "=============================================="
