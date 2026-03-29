const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const s3Client = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME || 'smartsave-profile-images';
const SIGNED_URL_EXPIRES_IN = 900; // 15 minutes

/**
 * Upload a buffer to S3 and return the object key (NOT a full URL).
 * @param {Buffer} fileBuffer
 * @param {string} key - S3 object key (e.g. "profile-images/<uuid>.jpg")
 * @param {string} contentType - MIME type
 * @returns {Promise<string>} The S3 object key
 */
async function uploadToS3(fileBuffer, key, contentType) {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: fileBuffer,
      ContentType: contentType,
    })
  );

  return key;
}

/**
 * Generate a short-lived pre-signed GET URL for a private S3 object.
 * @param {string} key - S3 object key
 * @returns {Promise<string>} Pre-signed URL (valid for SIGNED_URL_EXPIRES_IN seconds)
 */
async function getSignedImageUrl(key) {
  return getSignedUrl(
    s3Client,
    new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }),
    { expiresIn: SIGNED_URL_EXPIRES_IN }
  );
}

module.exports = { uploadToS3, getSignedImageUrl };
