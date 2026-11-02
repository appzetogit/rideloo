import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getDatabase, ServerValue } from 'firebase-admin/database';
import { getMessaging } from 'firebase-admin/messaging';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './env.js';

let firebaseDatabase = null;
let firebaseMessaging = null;
let firebaseInitAttempted = false;

const parseServiceAccountJson = (rawJson) => {
  if (!rawJson) {
    return null;
  }

  const parsed = JSON.parse(rawJson);

  if (parsed.private_key) {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }

  return parsed;
};

const readServiceAccount = () => {
  if (env.firebase.serviceAccountJson) {
    try {
      return parseServiceAccountJson(env.firebase.serviceAccountJson);
    } catch (error) {
      console.error('Firebase service account JSON parsing failed:', error.message);
      return null;
    }
  }

  if (!env.firebase.serviceAccountPath) {
    return null;
  }

  const credentialPath = path.isAbsolute(env.firebase.serviceAccountPath)
    ? env.firebase.serviceAccountPath
    : path.resolve(process.cwd(), env.firebase.serviceAccountPath);

  if (!fs.existsSync(credentialPath)) {
    console.warn(`Firebase service account file not found at ${credentialPath}. Falling back to env configuration if available.`);
    return null;
  }

  try {
    return parseServiceAccountJson(fs.readFileSync(credentialPath, 'utf8'));
  } catch (error) {
    console.error('Firebase service account file read failed:', error.message);
    return null;
  }
};

const getFirebaseApp = () => {
  if (getApps().length > 0) {
    return getApps()[0];
  }

  const serviceAccount = readServiceAccount();
  if (!serviceAccount && !env.firebase.databaseURL) {
    return null;
  }

  try {
    return initializeApp({
      ...(serviceAccount ? { credential: cert(serviceAccount) } : {}),
      ...(env.firebase.databaseURL ? { databaseURL: env.firebase.databaseURL } : {}),
    });
  } catch (error) {
    console.error('Firebase admin initialization failed:', error.message);
    return null;
  }
};

export const getFirebaseDatabase = () => {
  if (firebaseDatabase || firebaseInitAttempted) {
    return firebaseDatabase;
  }

  firebaseInitAttempted = true;

  if (!env.firebase.databaseURL) {
    return null;
  }

  const app = getFirebaseApp();
  if (!app) {
    return null;
  }

  try {
    firebaseDatabase = getDatabase(app);
    return firebaseDatabase;
  } catch (error) {
    console.error('Firebase database initialization failed:', error.message);
    return null;
  }
};

export const getFirebaseMessaging = () => {
  if (firebaseMessaging) {
    return firebaseMessaging;
  }

  const app = getFirebaseApp();
  if (!app) {
    return null;
  }

  try {
    firebaseMessaging = getMessaging(app);
    return firebaseMessaging;
  } catch (error) {
    console.error('Firebase messaging initialization failed:', error.message);
    return null;
  }
};

export const firebaseServerTimestamp = () => ServerValue.TIMESTAMP;
