'use strict';

const { generateKeyPairSync, randomBytes } = require('crypto');

/**
 * Generate an ED25519 SSH key pair using Node.js built-in crypto.
 * No shell-out, no temp files, no external dependencies.
 *
 * Returns:
 *   privateKeyPem    — OpenSSH private key format ("-----BEGIN OPENSSH PRIVATE KEY-----").
 *                      NOTE: OpenSSH cannot read PKCS8 PEM ED25519 keys — only its own
 *                      format — so we build that format here by hand.
 *   publicKeyOpenSSH — "ssh-ed25519 <base64> hashgg@hashgg" (authorized_keys format)
 */
function generateKeyPair() {
  const { privateKey: privateKeyObj, publicKey: spkiDer } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'der' },
  });

  // --- Extract raw 32-byte public key from SPKI DER (always 44 bytes total) ---
  if (spkiDer.length !== 44) {
    throw new Error(`Unexpected SPKI DER length: ${spkiDer.length} (expected 44)`);
  }
  const rawPub = spkiDer.slice(12);

  // --- Extract raw 32-byte private seed from PKCS8 DER (always 48 bytes total) ---
  const pkcs8Der = privateKeyObj.export({ format: 'der', type: 'pkcs8' });
  if (pkcs8Der.length !== 48) {
    throw new Error(`Unexpected PKCS8 DER length: ${pkcs8Der.length} (expected 48)`);
  }
  const rawSeed = pkcs8Der.slice(16);

  // --- SSH wire "string" helper: uint32(len) || bytes ---
  const sshString = (buf) => {
    const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf, 'utf8');
    const out = Buffer.allocUnsafe(4 + b.length);
    out.writeUInt32BE(b.length, 0);
    b.copy(out, 4);
    return out;
  };

  // Public key wire blob: string("ssh-ed25519") || string(rawPub)
  const pubBlob = Buffer.concat([sshString('ssh-ed25519'), sshString(rawPub)]);
  const publicKeyOpenSSH = `ssh-ed25519 ${pubBlob.toString('base64')} hashgg@hashgg`;

  // --- Build OpenSSH private key binary
  //     (format: https://github.com/openssh/openssh-portable/blob/master/PROTOCOL.key) ---
  const MAGIC = Buffer.from('openssh-key-v1\0', 'ascii');
  const checkint = randomBytes(4);
  const privSection = Buffer.concat([
    checkint, checkint,                          // two matching check ints
    sshString('ssh-ed25519'),                    // key type
    sshString(rawPub),                           // public key
    sshString(Buffer.concat([rawSeed, rawPub])), // private key = seed || pub (64 bytes)
    sshString(''),                               // comment
  ]);
  // Pad to multiple of 8 with 1,2,3,...
  const padLen = (8 - (privSection.length % 8)) % 8;
  const padded = Buffer.concat([
    privSection,
    Buffer.from(Array.from({ length: padLen }, (_, i) => i + 1)),
  ]);

  const body = Buffer.concat([
    MAGIC,
    sshString('none'),           // cipher
    sshString('none'),           // kdf name
    sshString(''),               // kdf options
    Buffer.from([0, 0, 0, 1]),   // number of keys
    sshString(pubBlob),          // public key blob
    sshString(padded),           // private key section (unencrypted)
  ]);

  const b64 = body.toString('base64');
  const lines = [];
  for (let i = 0; i < b64.length; i += 70) lines.push(b64.slice(i, i + 70));
  const privateKeyPem =
    '-----BEGIN OPENSSH PRIVATE KEY-----\n' +
    lines.join('\n') + '\n' +
    '-----END OPENSSH PRIVATE KEY-----\n';

  return { privateKeyPem, publicKeyOpenSSH };
}

module.exports = { generateKeyPair };
