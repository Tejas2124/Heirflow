const fs = require('fs');
const os = require('os');
const path = require('path');
const { Firestore } = require('@google-cloud/firestore');

const PROJECT_ID = process.env.GCP_PROJECT_ID;
const DATABASE_ID = process.env.FIRESTORE_DATABASE_ID || '(default)';
const USE_LOCAL_ONLY = process.env.USE_LOCAL_ONLY === 'true';

/**
 * Checks whether GCP Application Default Credentials or Cloud Run metadata are available
 * before instantiating Firestore, avoiding detached gRPC auth crashes when offline.
 */
function hasGcpCredentials() {
  if (process.env.K_SERVICE || process.env.GOOGLE_CLOUD_PROJECT) return true;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    return true;
  }
  const adcPath =
    process.platform === 'win32'
      ? path.join(process.env.APPDATA || '', 'gcloud', 'application_default_credentials.json')
      : path.join(os.homedir(), '.config', 'gcloud', 'application_default_credentials.json');
  return fs.existsSync(adcPath);
}

/**
 * Behavioral Data Domains in Google Cloud Firestore:
 *  - users              : Identity, authentication & KYC profiles
 *  - assets             : Encrypted digital & physical estate vault items
 *  - nominees           : Authorized nominee roster, permissions & key shares
 *  - gate_claims        : Verification Gate state machine & quorum tracking
 *  - gate_claim_actions : Post-mortem asset handover & cancellation records
 *  - audit_logs         : Append-only immutable security & compliance events
 */
const COLLECTIONS = {
  USERS: 'users',
  ASSETS: 'assets',
  NOMINEES: 'nominees',
  GATE_CLAIMS: 'gate_claims',
  GATE_CLAIM_ACTIONS: 'gate_claim_actions',
  AUDIT_LOGS: 'audit_logs',
};

let firestore = null;
let cloudReady = false;

function getFirestoreClient() {
  if (USE_LOCAL_ONLY || !PROJECT_ID || !hasGcpCredentials()) return null;
  if (!firestore) {
    const options = { projectId: PROJECT_ID, databaseId: DATABASE_ID, preferRest: true };
    firestore = new Firestore(options);
  }
  return firestore;
}

/**
 * Loads all behavior-separated collections from Firestore.
 * If Firestore is empty, seeds it from the local `tables` object.
 */
async function initAndHydrate(localTables) {
  const client = getFirestoreClient();
  if (!client) {
    return { connected: false, reason: USE_LOCAL_ONLY ? 'USE_LOCAL_ONLY=true' : 'GCP_PROJECT_ID not set' };
  }

  try {
    // Quick connectivity check with a 4s timeout so local startup never hangs
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Firestore connection timeout (4s)')), 4000)
    );

    const hydratePromise = (async () => {
      const usersSnap = await client.collection(COLLECTIONS.USERS).limit(1).get();

      if (usersSnap.empty && localTables.users.length > 0) {
        // First-time cloud seed from local tables
        await pushAllToFirestore(client, localTables);
        console.log('☁️ Firestore initialized & seeded from local data across 6 behavioral collections');
        return { connected: true, seeded: true };
      }

      // Hydrate local memory from Firestore collections
      const collectionKeys = [
        { key: 'users', col: COLLECTIONS.USERS },
        { key: 'assets', col: COLLECTIONS.ASSETS },
        { key: 'nominees', col: COLLECTIONS.NOMINEES },
        { key: 'gate_claims', col: COLLECTIONS.GATE_CLAIMS },
        { key: 'gate_claim_actions', col: COLLECTIONS.GATE_CLAIM_ACTIONS },
        { key: 'audit_logs', col: COLLECTIONS.AUDIT_LOGS },
      ];

      for (const { key, col } of collectionKeys) {
        const snap = await client.collection(col).get();
        if (!snap.empty) {
          localTables[key] = snap.docs.map((doc) => doc.data());
        }
      }

      console.log(
        `☁️ Firestore hydrated: ${localTables.users.length} users, ${localTables.assets.length} assets, ${localTables.nominees.length} nominees, ${localTables.gate_claims.length} gate_claims`
      );
      return { connected: true, hydrated: true };
    })();

    const result = await Promise.race([hydratePromise, timeoutPromise]);
    cloudReady = true;
    return result;
  } catch (err) {
    cloudReady = false;
    console.warn(`⚠️ Firestore unavailable (${err.message}). Continuing with local heirflow-data.json.`);
    return { connected: false, reason: err.message };
  }
}

/**
 * Batch-pushes all behavioral collections to Firestore
 */
async function pushAllToFirestore(client, tables) {
  const mappings = [
    { items: tables.users || [], col: COLLECTIONS.USERS, idField: 'id' },
    { items: tables.assets || [], col: COLLECTIONS.ASSETS, idField: 'id' },
    { items: tables.nominees || [], col: COLLECTIONS.NOMINEES, idField: 'id' },
    { items: tables.gate_claims || [], col: COLLECTIONS.GATE_CLAIMS, idField: 'claim_id' },
    { items: tables.gate_claim_actions || [], col: COLLECTIONS.GATE_CLAIM_ACTIONS, idField: 'id' },
    { items: tables.audit_logs || [], col: COLLECTIONS.AUDIT_LOGS, idField: 'id' },
  ];

  for (const { items, col, idField } of mappings) {
    if (items.length === 0) continue;
    // Firestore batch limit is 500 ops
    for (let i = 0; i < items.length; i += 450) {
      const batch = client.batch();
      const chunk = items.slice(i, i + 450);
      for (const item of chunk) {
        const docId = item[idField];
        if (!docId) continue;
        batch.set(client.collection(col).doc(String(docId)), JSON.parse(JSON.stringify(item)));
      }
      await batch.commit();
    }
  }
}

/**
 * Asynchronously upserts a single document into its behavioral Firestore collection
 */
function syncUpsert(collectionName, docId, data) {
  if (!cloudReady || !firestore || !docId) return;
  const cleanData = JSON.parse(JSON.stringify(data));
  firestore
    .collection(collectionName)
    .doc(String(docId))
    .set(cleanData, { merge: true })
    .catch((err) => console.warn(`⚠️ Firestore upsert failed [${collectionName}/${docId}]:`, err.message));
}

/**
 * Asynchronously deletes a single document from its behavioral Firestore collection
 */
function syncDelete(collectionName, docId) {
  if (!cloudReady || !firestore || !docId) return;
  firestore
    .collection(collectionName)
    .doc(String(docId))
    .delete()
    .catch((err) => console.warn(`⚠️ Firestore delete failed [${collectionName}/${docId}]:`, err.message));
}

module.exports = {
  COLLECTIONS,
  initAndHydrate,
  pushAllToFirestore,
  getFirestoreClient,
  syncUpsert,
  syncDelete,
  isCloudConnected: () => cloudReady,
};
