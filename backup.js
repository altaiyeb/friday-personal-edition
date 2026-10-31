
/* ==========================================
   FRIDAY V2 — ENCRYPTED ZIP BACKUPS
   Genuine ZIP archive, AES-256-GCM encryption
   No external libraries or CDN dependencies
   ========================================== */

(() => {
  "use strict";

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const ITERATIONS = 600000;
  const MAX_ARCHIVE_SIZE = 50 * 1024 * 1024;
  const MAX_DATA_SIZE = 40 * 1024 * 1024;
  const FILE_NAME = "friday-v2-encrypted.bin";

  function randomBytes(length) {
    return crypto.getRandomValues(new Uint8Array(length));
  }

  function concat(...arrays) {
    const size = arrays.reduce((sum, array) => sum + array.length, 0);
    const result = new Uint8Array(size);
    let offset = 0;

    for (const array of arrays) {
      result.set(array, offset);
      offset += array.length;
    }

    return result;
  }

  function write16(view, offset, value) {
    view.setUint16(offset, value, true);
  }

  function write32(view, offset, value) {
    view.setUint32(offset, value >>> 0, true);
  }

  function read16(view, offset) {
    return view.getUint16(offset, true);
  }

  function read32(view, offset) {
    return view.getUint32(offset, true);
  }

  function crc32(bytes) {
    let crc = 0xffffffff;

    for (const byte of bytes) {
      crc ^= byte;

      for (let bit = 0; bit < 8; bit++) {
        crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
      }
    }

    return (crc ^ 0xffffffff) >>> 0;
  }

  function validatePassphrase(passphrase) {
    if (typeof passphrase !== "string" || passphrase.length < 12) {
      throw new Error("Use a backup passphrase of at least 12 characters.");
    }
  }

  async function deriveBackupKey(passphrase, salt) {
    validatePassphrase(passphrase);

    const material = await crypto.subtle.importKey(
      "raw",
      encoder.encode(passphrase),
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

  async function encryptBackup(data, passphrase) {
    const salt = randomBytes(16);
    const iv = randomBytes(12);
    const key = await deriveBackupKey(passphrase, salt);

    const plaintext = encoder.encode(JSON.stringify(data));

    if (plaintext.length > MAX_DATA_SIZE) {
      throw new Error("Backup is too large.");
    }

    const encrypted = await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: encoder.encode("FRIDAY-V2-BACKUP")
      },
      key,
      plaintext
    );

    const header = {
      format: "FRIDAY-ENCRYPTED-BACKUP",
      version: 2,
      algorithm: "AES-256-GCM",
      kdf: "PBKDF2-SHA-256",
      iterations: ITERATIONS,
      salt: Array.from(salt),
      iv: Array.from(iv),
      createdAt: new Date().toISOString()
    };

    const headerBytes = encoder.encode(JSON.stringify(header));
    const encryptedBytes = new Uint8Array(encrypted);

    const output = new Uint8Array(4 + headerBytes.length + encryptedBytes.length);
    const view = new DataView(output.buffer);

    output.set([70, 82, 68, 89], 0); // FRDY
    write32(view, 4, headerBytes.length);
    output.set(headerBytes, 8);
    output.set(encryptedBytes, 8 + headerBytes.length);

    return output;
  }

  async function decryptBackup(bytes, passphrase) {
    if (!(bytes instanceof Uint8Array)) {
      bytes = new Uint8Array(bytes);
    }

    if (bytes.length < 64 || bytes.length > MAX_ARCHIVE_SIZE) {
      throw new Error("Invalid or oversized backup.");
    }

    if (
      bytes[0] !== 70 ||
      bytes[1] !== 82 ||
      bytes[2] !== 68 ||
      bytes[3] !== 89
    ) {
      throw new Error("This is not a FRIDAY backup.");
    }

    const view = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength
    );

    const headerLength = read32(view, 4);

    if (headerLength < 2 || headerLength > 4096 || 8 + headerLength >= bytes.length) {
      throw new Error("Invalid backup header.");
    }

    let header;

    try {
      header = JSON.parse(
        decoder.decode(bytes.slice(8, 8 + headerLength))
      );
    } catch {
      throw new Error("Backup metadata is damaged.");
    }

    if (
      header.format !== "FRIDAY-ENCRYPTED-BACKUP" ||
      header.version !== 2 ||
      header.algorithm !== "AES-256-GCM" ||
      header.kdf !== "PBKDF2-SHA-256" ||
      header.iterations !== ITERATIONS
    ) {
      throw new Error("Unsupported backup format.");
    }

    if (
      !Array.isArray(header.salt) ||
      header.salt.length !== 16 ||
      !Array.isArray(header.iv) ||
      header.iv.length !== 12 ||
      !header.salt.every(n => Number.isInteger(n) && n >= 0 && n <= 255) ||
      !header.iv.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
    ) {
      throw new Error("Invalid backup encryption parameters.");
    }

    validatePassphrase(passphrase);

    const salt = new Uint8Array(header.salt);
    const iv = new Uint8Array(header.iv);
    const key = await deriveBackupKey(passphrase, salt);
    const ciphertext = bytes.slice(8 + headerLength);

    let plaintext;

    try {
      plaintext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: encoder.encode("FRIDAY-V2-BACKUP")
        },
        key,
        ciphertext
      );
    } catch {
      throw new Error("Incorrect backup passphrase or damaged archive.");
    }

    let result;

    try {
      result = JSON.parse(decoder.decode(plaintext));
    } catch {
      throw new Error("Backup contents are invalid.");
    }

    validateData(result);

    return result;
  }

  function validateData(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Invalid backup data.");
    }

    const requiredArrays = [
      "tasks",
      "notes",
      "events",
      "reminders",
      "transactions",
      "budgets",
      "goals",
      "profiles"
    ];

    for (const key of requiredArrays) {
      if (!Array.isArray(data[key])) {
        throw new Error(`Backup is missing valid ${key} data.`);
      }

      if (data[key].length > 100000) {
        throw new Error("Backup contains too many records.");
      }
    }

    if (!data.settings || typeof data.settings !== "object") {
      throw new Error("Backup settings are invalid.");
    }

    const allowedThemes = [
      "obsidian",
      "nebula",
      "arctic",
      "emerald",
      "inferno"
    ];

    const allowedLogos = [
      "monogram",
      "orbit",
      "core",
      "nexus"
    ];

    if (
      !allowedThemes.includes(data.settings.theme) ||
      !allowedLogos.includes(data.settings.logo)
    ) {
      throw new Error("Backup contains unsupported appearance settings.");
    }

        const currency = data.settings.currency;

    if (
      typeof currency !== "string" ||
      !/^[A-Z]{3}$/.test(currency)
    ) {
      throw new Error("Backup contains an invalid currency.");
    }

    try {
      new Intl.NumberFormat("en", {
        style: "currency",
        currency
      });
    } catch {
      throw new Error("Backup contains an unsupported currency.");
    }
     
  /* ZIP FORMAT — STORE METHOD, NO COMPRESSION */

  function createZip(filename, fileBytes) {
    const name = encoder.encode(filename);
    const checksum = crc32(fileBytes);

    const localHeader = new Uint8Array(30 + name.length);
    const localView = new DataView(localHeader.buffer);

    write32(localView, 0, 0x04034b50);
    write16(localView, 4, 20);
    write16(localView, 6, 0);
    write16(localView, 8, 0);
    write16(localView, 10, 0);
    write16(localView, 12, 0);
    write32(localView, 14, checksum);
    write32(localView, 18, fileBytes.length);
    write32(localView, 22, fileBytes.length);
    write16(localView, 26, name.length);
    write16(localView, 28, 0);
    localHeader.set(name, 30);

    const centralHeader = new Uint8Array(46 + name.length);
    const centralView = new DataView(centralHeader.buffer);

    write32(centralView, 0, 0x02014b50);
    write16(centralView, 4, 20);
    write16(centralView, 6, 20);
    write16(centralView, 8, 0);
    write16(centralView, 10, 0);
    write16(centralView, 12, 0);
    write16(centralView, 14, 0);
    write32(centralView, 16, checksum);
    write32(centralView, 20, fileBytes.length);
    write32(centralView, 24, fileBytes.length);
    write16(centralView, 28, name.length);
    write16(centralView, 30, 0);
    write16(centralView, 32, 0);
    write16(centralView, 34, 0);
    write16(centralView, 36, 0);
    write32(centralView, 38, 0);
    write32(centralView, 42, 0);
    centralHeader.set(name, 46);

    const centralOffset = localHeader.length + fileBytes.length;

    const end = new Uint8Array(22);
    const endView = new DataView(end.buffer);

    write32(endView, 0, 0x06054b50);
    write16(endView, 4, 0);
    write16(endView, 6, 0);
    write16(endView, 8, 1);
    write16(endView, 10, 1);
    write32(endView, 12, centralHeader.length);
    write32(endView, 16, centralOffset);
    write16(endView, 20, 0);

    return concat(localHeader, fileBytes, centralHeader, end);
  }

  function readZip(bytes) {
    if (!(bytes instanceof Uint8Array)) {
      bytes = new Uint8Array(bytes);
    }

    if (bytes.length > MAX_ARCHIVE_SIZE || bytes.length < 22) {
      throw new Error("Invalid or oversized ZIP file.");
    }

    const view = new DataView(
      bytes.buffer,
      bytes.byteOffset,
      bytes.byteLength
    );

    let endOffset = -1;

    const searchStart = Math.max(0, bytes.length - 65557);

    for (let i = bytes.length - 22; i >= searchStart; i--) {
      if (read32(view, i) === 0x06054b50) {
        endOffset = i;
        break;
      }
    }

    if (endOffset < 0) {
      throw new Error("ZIP directory not found.");
    }

    const entries = read16(view, endOffset + 10);
    const centralSize = read32(view, endOffset + 12);
    const centralOffset = read32(view, endOffset + 16);

    if (
      entries !== 1 ||
      centralOffset + centralSize > endOffset ||
      centralOffset + 46 > bytes.length
    ) {
      throw new Error("Unsupported or invalid ZIP archive.");
    }

    if (read32(view, centralOffset) !== 0x02014b50) {
      throw new Error("Invalid ZIP directory.");
    }

    const method = read16(view, centralOffset + 10);
    const checksum = read32(view, centralOffset + 16);
    const compressedSize = read32(view, centralOffset + 20);
    const uncompressedSize = read32(view, centralOffset + 24);
    const nameLength = read16(view, centralOffset + 28);
    const extraLength = read16(view, centralOffset + 30);
    const commentLength = read16(view, centralOffset + 32);
    const localOffset = read32(view, centralOffset + 42);

    if (
      method !== 0 ||
      compressedSize !== uncompressedSize ||
      uncompressedSize > MAX_DATA_SIZE ||
      nameLength > 256 ||
      centralOffset + 46 + nameLength + extraLength + commentLength > bytes.length
    ) {
      throw new Error("Unsupported ZIP compression or invalid entry.");
    }

    const filename = decoder.decode(
      bytes.slice(centralOffset + 46, centralOffset + 46 + nameLength)
    );

    if (filename !== FILE_NAME) {
      throw new Error("This ZIP does not contain a FRIDAY backup.");
    }

    if (read32(view, localOffset) !== 0x04034b50) {
      throw new Error("Invalid ZIP file entry.");
    }

    const localNameLength = read16(view, localOffset + 26);
    const localExtraLength = read16(view, localOffset + 28);

    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataOffset + compressedSize;

    if (
      dataOffset < 30 ||
      dataEnd > centralOffset ||
      dataEnd > bytes.length
    ) {
      throw new Error("ZIP entry is outside the archive.");
    }

    const payload = bytes.slice(dataOffset, dataEnd);

    if (crc32(payload) !== checksum) {
      throw new Error("ZIP integrity check failed.");
    }

    return payload;
  }

  async function create(data, passphrase) {
    const encrypted = await encryptBackup(data, passphrase);
    const archive = createZip(FILE_NAME, encrypted);

    return new Blob([archive], {
      type: "application/zip"
    });
  }

  async function restore(file, passphrase) {
    if (!file || file.size > MAX_ARCHIVE_SIZE) {
      throw new Error("Invalid or oversized backup file.");
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    const encrypted = readZip(bytes);

    return decryptBackup(encrypted, passphrase);
  }

  window.FridayBackup = Object.freeze({
    create,
    restore
  });
})();
