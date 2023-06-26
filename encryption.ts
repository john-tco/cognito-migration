import {
  RawAesKeyringNode,
  buildClient,
  CommitmentPolicy,
  RawAesWrappingSuiteIdentifier,
} from '@aws-crypto/client-node';
import { TextEncoder } from 'util';
import {
  ENCRYPTION_WRAPPING_KEY,
  ENCRYPTION_KEY_NAME,
  ENCRYPTION_KEY_NAMESPACE,
} from './secrets';

const encoder = new TextEncoder();

const keyName = ENCRYPTION_KEY_NAME;
const keyNamespace = ENCRYPTION_KEY_NAMESPACE;

const unencryptedMasterKey = encoder.encode(ENCRYPTION_WRAPPING_KEY);
const wrappingSuite =
  RawAesWrappingSuiteIdentifier.AES256_GCM_IV12_TAG16_NO_PADDING;

const keyRing = new RawAesKeyringNode({
  keyName,
  keyNamespace,
  unencryptedMasterKey,
  wrappingSuite,
});

const encryptionClient = buildClient(
  CommitmentPolicy.REQUIRE_ENCRYPT_REQUIRE_DECRYPT
);

const context = {
  purpose: 'Gov.UK Cognito -> Postgres Migration',
};

export async function encrypt(cleartext: string) {
  const { result } = await encryptionClient.encrypt(keyRing, cleartext, {
    encryptionContext: context,
  });
  const cipherText = b64Encode(result);
  return cipherText;
}

export async function decrypt(cipherText: string) {
  const { plaintext, messageHeader } = await encryptionClient.decrypt(
    keyRing,
    b64Decode(cipherText)
  );
  const { encryptionContext } = messageHeader;
  Object.entries(context).forEach(([key, value]) => {
    if (encryptionContext[key] !== value)
      throw new Error('Encryption Context does not match expected values');
  });

  return plaintext.toString();
}

function b64Encode(buff: Buffer) {
  return buff.toString('base64');
}

function b64Decode(str: string) {
  return Buffer.from(str, 'base64');
}
