
/*
 * FRIDAY V2 — Local Encryption Engine
 * AES-256-GCM + PBKDF2-SHA-256
 *
 * Each installation creates its own random salt.
 * The PIN-derived key remains in memory only while unlocked.
 */

(() => {
  "use strict";

  const DB_NAME = "friday-secure-v2";
  const DB_VERSION = 1;
  const ITERATIONS = 600000;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  let db = null;
  let key = null;
  let unlockedData = null;

  function randomBytes(length) {
    return crypto.getRandomValues(new Uint8Array(length));
  }

  function toHex(bytes) {
    return Array.from(bytes, byte =>
      byte.toString(16).padStart(2, "0")
    ).join("");
  }

  function fromHex(hex) {
    if (typeof hex !== "string" || !/^(?:[0-9a-f]{2})+$/i.test(hex)) {
      throw new Error("Invalid encrypted data.");
    }

    return new Uint8Array(
      hex.match(/.{2}/g).map(byte => parseInt(byte, 16))
    );
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;

        if (!database.objectStoreNames.contains("vault")) {
          database.createObjectStore("vault");
        }

        if (!database.objectStoreNames.contains("config")) {
          database.createObjectStore("config");
        }
      };

      request.onsuccess = () => {
        db = request.result;
        resolve(db);
      };

      request.onerror = () => reject(request.error);
    });
  }

  function readRecord(storeName, recordKey) {
    return new Promise((resolve, reject) => {
      const request = db
        .transaction(storeName, "readonly")
        .objectStore(storeName)
        .get(recordKey);

      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
    });
  }

  function writeRecords(records) {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(
        ["vault", "config"],
        "readwrite"
      );

      transaction.objectStore("vault").put(records.envelope, "data");
      transaction.objectStore("config").put(records.config, "settings");

      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }

  async function deriveKey(pin, salt) {
    if (typeof pin !== "string" || pin.length < 8) {
      throw new Error("Use a PIN or passphrase of at least 8 characters.");
    }

    const material = await crypto.subtle.importKey(
      "raw",
      encoder.encode(pin),
      "PBKDF2",
      false,
      ["deriveKey"]
    );

    return crypto.subtle.deriveKey(
      {
        name: "PBKDF2",
        salt,
        iterations: ITERATIONS,
        hash: "SHA-256"
      },
      material,
      {
        name: "AES-GCM",
        length: 256
      },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encrypt(data, encryptionKey) {
    const iv = randomBytes(12);

    const ciphertext = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv
      },
      encryptionKey,
      encoder.encode(JSON.stringify(data))
    );

    return {
      version: 1,
      algorithm: "AES-256-GCM",
      iv: toHex(iv),
      ciphertext: toHex(new Uint8Array(ciphertext))
    };
  }

  async function decrypt(envelope, encryptionKey) {
    if (
      !envelope ||
      envelope.version !== 1 ||
      envelope.algorithm !== "AES-256-GCM"
    ) {
      throw new Error("Unsupported vault format.");
    }

    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromHex(envelope.iv)
      },
      encryptionKey,
      fromHex(envelope.ciphertext)
    );

    return JSON.parse(decoder.decode(plaintext));
  }

  async function initialize(pin, initialData = {}) {
    await openDatabase();

    const existing = await readRecord("config", "settings");

    if (existing) {
      throw new Error("A vault already exists on this installation.");
    }

    const salt = randomBytes(16);
    const derivedKey = await deriveKey(pin, salt);

    const config = {
      version: 1,
      algorithm: "PBKDF2-SHA-256",
      iterations: ITERATIONS,
      salt: toHex(salt)
    };

    const envelope = await encrypt(initialData, derivedKey);

    await writeRecords({ config, envelope });

    key = derivedKey;
    unlockedData = structuredClone(initialData);

    return true;
  }

    async function unlock(pin) {
    // Clear any previous unlocked session before attempting access.
    key = null;
    unlockedData = null;

    await openDatabase();

    const config = await readRecord("config", "settings");
    const envelope = await readRecord("vault", "data");

    if (!config || !envelope) {
      throw new Error("No vault has been created on this installation.");
    }

    if (
      config.version !== 1 ||
      config.algorithm !== "PBKDF2-SHA-256" ||
      config.iterations !== ITERATIONS
    ) {
      throw new Error("Unsupported vault configuration.");
    }

    const derivedKey = await deriveKey(
      pin,
      fromHex(config.salt)
    );

    // AES-GCM authentication rejects an incorrect PIN or altered data.
    const data = await decrypt(envelope, derivedKey);

    key = derivedKey;
    unlockedData = data;

    return structuredClone(unlockedData);
  }
  
  async function save(data) {
    if (!key) {
      throw new Error("Unlock FRIDAY before saving data.");
    }

    const config = await readRecord("config", "settings");

    if (!config) {
      throw new Error("Vault configuration is missing.");
    }

    const envelope = await encrypt(data, key);

    await new Promise((resolve, reject) => {
      const transaction = db.transaction("vault", "readwrite");

      transaction.objectStore("vault").put(envelope, "data");

      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });

    unlockedData = structuredClone(data);
    return true;
  }

  function getData() {
    if (!key || unlockedData === null) {
      throw new Error("FRIDAY is locked.");
    }

    return structuredClone(unlockedData);
  }

  async function changePin(oldPin, newPin) {
    const data = await unlock(oldPin);

    const salt = randomBytes(16);
    const newKey = await deriveKey(newPin, salt);

    const config = {
      version: 1,
      algorithm: "PBKDF2-SHA-256",
      iterations: ITERATIONS,
      salt: toHex(salt)
    };

    const envelope = await encrypt(data, newKey);

    await writeRecords({ config, envelope });

    key = newKey;
    unlockedData = data;

    return true;
  }

  function lock() {
    key = null;
    unlockedData = null;
  }

  async function hasVault() {
    await openDatabase();
    return Boolean(await readRecord("config", "settings"));
  }

  window.FridayVault = Object.freeze({
    initialize,
    unlock,
    save,
    getData,
    changePin,
    lock,
    hasVault
  });
})();
