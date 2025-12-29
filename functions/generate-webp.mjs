import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';

const s3 = new S3Client();
const webpQuality = 82;
const targetWidths = [480, 960, 1440, 1920];

export const handler = async (event) => {
  const bucketName = event?.detail?.bucket?.name;
  const key = decodeKey(event?.detail?.object?.key);
  if (!bucketName || !key) {
    console.warn('Unsupported event payload');
    return;
  }

  await handleKey(bucketName, key);
};

const handleKey = async (bucketName, key) => {
  let body;
  try {
    const getObject = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
    body = await streamToBuffer(getObject.Body);
  } catch (err) {
    console.error('Failed to read source object', { key, err });
    return;
  }

  let metadata;
  try {
    metadata = await sharp(body).metadata();
  } catch (err) {
    console.warn('Skipping non-image object', { key });
    return;
  }

  const webpKey = toWebpKey(key);
  if (!webpKey) {
    return;
  }

  const exists = await objectExists(bucketName, webpKey);
  if (!exists) {
    const webpBody = await sharp(body).webp({ quality: webpQuality }).toBuffer();
    await putWebpObject(bucketName, webpKey, webpBody);
  }

  if (!metadata?.width) {
    return;
  }

  const widthTargets = targetWidths.filter((width) => width <= metadata.width);
  await Promise.allSettled(widthTargets.map(async (width) => {
    const sizedKey = toSizedWebpKey(key, width);
    const sizedExists = await objectExists(bucketName, sizedKey);
    if (sizedExists) {
      return;
    }

    const resizedBody = await sharp(body)
      .resize({ width })
      .webp({ quality: webpQuality })
      .toBuffer();
    await putWebpObject(bucketName, sizedKey, resizedBody);
  }));
};

const decodeKey = (key) => {
  if (!key) {
    return '';
  }
  return decodeURIComponent(key.replace(/\+/g, ' '));
};

const toWebpKey = (key) => {
  const lastSlash = key.lastIndexOf('/');
  const lastDot = key.lastIndexOf('.');
  if (lastDot === -1 || lastDot < lastSlash) {
    return `${key}.webp`;
  }
  return `${key.slice(0, lastDot)}.webp`;
};

const toSizedWebpKey = (key, width) => {
  const lastSlash = key.lastIndexOf('/');
  const lastDot = key.lastIndexOf('.');
  if (lastDot === -1 || lastDot < lastSlash) {
    return `${key}-${width}.webp`;
  }
  return `${key.slice(0, lastDot)}-${width}.webp`;
};

const objectExists = async (bucketName, key) => {
  try {
    await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: key, Range: 'bytes=0-0' }));
    return true;
  } catch (err) {
    if (err?.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw err;
  }
};

const streamToBuffer = async (stream) => {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
};

const putWebpObject = async (bucketName, key, body) => {
  await s3.send(new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    Body: body,
    ContentType: 'image/webp',
    ACL: 'public-read',
    CacheControl: 'public, max-age=31536000, immutable'
  }));
};
