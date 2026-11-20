# ==========================================
# HeirFlow — One-Click Google Cloud Run Deployment
# PowerShell script for Windows developers
# ==========================================

param (
    [string]$ProjectId = "heirflow-515305",
    [string]$Region = "asia-south1",
    [string]$ServiceName = "heirflow",
    [string]$GeminiApiKey = "",
    [string]$GcsBucket = "heirflow-evidence-vault",
    [string]$FirestoreDb = "hierflow-db"
)

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host " 🏛️  HeirFlow — Google Cloud Run Deploy" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan

# 1. Verify gcloud CLI is installed
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    Write-Error "Error: Google Cloud SDK (gcloud) is not installed or not in PATH."
    Write-Host "Please install it from: https://cloud.google.com/sdk/docs/install" -ForegroundColor Yellow
    exit 1
}

# 2. Get or prompt for GCP Project ID
if ([string]::IsNullOrWhiteSpace($ProjectId)) {
    $currentProject = (gcloud config get-value project 2>$null)
    if (-not [string]::IsNullOrWhiteSpace($currentProject)) {
        $ProjectId = $currentProject
        Write-Host "Using currently configured GCP project: $ProjectId" -ForegroundColor Green
    } else {
        $ProjectId = Read-Host "Enter your Google Cloud Project ID"
    }
}

if ([string]::IsNullOrWhiteSpace($ProjectId)) {
    Write-Error "Project ID is required. Exiting."
    exit 1
}

gcloud config set project $ProjectId

# 3. Enable necessary Google Cloud APIs
Write-Host "`n[1/4] Enabling required Google Cloud APIs..." -ForegroundColor Yellow
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com storage.googleapis.com firestore.googleapis.com

# 4. Optional: Create GCS Bucket if specified
if (-not [string]::IsNullOrWhiteSpace($GcsBucket)) {
    Write-Host "`n[2/4] Ensuring GCS bucket exists: gs://$GcsBucket..." -ForegroundColor Yellow
    gcloud storage buckets create "gs://$GcsBucket" --location=$Region --uniform-bucket-level-access --public-access-prevention 2>$null
}

# 5. Build environment variables string
$envVars = "NODE_ENV=production,GCP_PROJECT_ID=$ProjectId,FIRESTORE_DATABASE_ID=$FirestoreDb"
if (-not [string]::IsNullOrWhiteSpace($GeminiApiKey)) {
    $envVars += ",GEMINI_API_KEY=$GeminiApiKey"
}
if (-not [string]::IsNullOrWhiteSpace($GcsBucket)) {
    $envVars += ",GCS_BUCKET_NAME=$GcsBucket"
}

# 6. Deploy directly to Google Cloud Run from source
Write-Host "`n[3/4] Building and Deploying to Google Cloud Run..." -ForegroundColor Yellow
Write-Host "This will build the container on Google Cloud Build and deploy it to Cloud Run." -ForegroundColor Gray

gcloud run deploy $ServiceName `
    --source . `
    --region $Region `
    --platform managed `
    --allow-unauthenticated `
    --set-env-vars $envVars

# 7. Success output
if ($LASTEXITCODE -eq 0) {
    Write-Host "`n=========================================" -ForegroundColor Green
    Write-Host "🎉 HeirFlow successfully deployed to Google Cloud!" -ForegroundColor Green
    Write-Host "=========================================" -ForegroundColor Green
    $url = (gcloud run services describe $ServiceName --region $Region --format 'value(status.url)')
    Write-Host "🌐 Live Application URL: $url" -ForegroundColor Cyan
    Write-Host "📋 Health Check URL:     $url/api/health" -ForegroundColor Cyan
} else {
    Write-Host "`nDeployment encountered an error. Check the logs above." -ForegroundColor Red
}