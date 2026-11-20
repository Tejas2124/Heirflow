const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

let storageClient = null;
let bucket = null;

const BUCKET_NAME = process.env.GCS_BUCKET_NAME;
const PROJECT_ID = process.env.GCP_PROJECT_ID;

// Initialize Google Cloud Storage if credentials or bucket configured
try {
  const { Storage } = require('@google-cloud/storage');
  if (BUCKET_NAME) {
    const options = {};
    if (PROJECT_ID) options.projectId = PROJECT_ID;
    storageClient = new Storage(options);
    bucket = storageClient.bucket(BUCKET_NAME);
    console.log(`☁️ Google Cloud Storage initialized: gs://${BUCKET_NAME}`);
  }
} catch (err) {
  console.warn('⚠️ GCS initialization skipped, using local storage fallback:', err.message);
}

// Local fallback directory
const UPLOADS_DIR = path.join(__dirname, '../uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/**
 * Upload a file to Google Cloud Storage (with local fallback)
 * @param {Buffer} buffer - File buffer
 * @param {string} originalname - Original file name
 * @param {string} mimetype - File MIME type
 * @param {string} folder - Destination folder (e.g., 'evidence', 'certificates')
 * @returns {Promise<{ filename: string, url: string, storage: 'gcs' | 'local' }>}
 */
async function uploadFile(buffer, originalname, mimetype = 'application/octet-stream', folder = 'evidence') {
  const ext = path.extname(originalname);
  const safeName = `${folder}/${Date.now()}-${uuidv4()}${ext}`;

  // If GCS bucket is available, upload to Google Cloud Storage
  if (bucket) {
    try {
      const file = bucket.file(safeName);
      await file.save(buffer, {
        contentType: mimetype,
        resumable: false,
        metadata: {
          cacheControl: 'public, max-age=31536000',
        },
      });

      const publicUrl = `https://storage.googleapis.com/${BUCKET_NAME}/${safeName}`;
      return {
        filename: safeName,
        url: publicUrl,
        storage: 'gcs',
        bucket: BUCKET_NAME,
      };
    } catch (gcsError) {
      console.error('GCS upload error, falling back to local storage:', gcsError.message);
    }
  }

  // Local filesystem fallback
  const localFilename = `${Date.now()}-${uuidv4()}${ext}`;
  const localPath = path.join(UPLOADS_DIR, localFilename);
  fs.writeFileSync(localPath, buffer);

  return {
    filename: localFilename,
    url: `/api/storage/file/${localFilename}`,
    storage: 'local',
  };
}

/**
 * Generate a signed URL for secure, time-limited access to a document in GCS
 * @param {string} filename - GCS object path
 * @param {number} expiryMinutes - URL expiry time in minutes (default 60)
 * @returns {Promise<string>}
 */
async function getSignedUrl(filename, expiryMinutes = 60) {
  if (!bucket) {
    return `/api/storage/file/${filename}`;
  }

  const [url] = await bucket.file(filename).getSignedUrl({
    version: 'v4',
    action: 'read',
    expires: Date.now() + expiryMinutes * 60 * 1000,
  });

  return url;
}

module.exports = {
  uploadFile,
  getSignedUrl,
  isGcsConfigured: () => Boolean(bucket),
};

