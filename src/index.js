// Convenir.js
import { ethers, keccak256 } from "ethers";
import { randomBytes } from "crypto"; // For Node.js.  For browsers, use a different library (e.g., crypto-js)
import * as libsodium from "libsodium-wrappers";
import { v4 as uuidv4 } from "uuid";

// Import the ABIs (using the correct relative paths)
const EnclaveServiceABI =
  require("../artifacts/contracts/EnclaveService.sol/EnclaveService.json").abi;
const CourierABI =
  require("../artifacts/contracts/Courier.sol/Courier.json").abi;
const CustodianABI =
  require("../artifacts/contracts/Custodian.sol/Custodian.json").abi;

// --- Utility Functions ---

/**
 * Generates the input commitment hash.
 * @param {object} inputData The input data object.
 * @returns {string} The keccak256 hash of the serialized input data.
 */
function generateCommitmentHash(inputData) {
  const serializedData = JSON.stringify(inputData);
  const hash = keccak256(ethers.toUtf8Bytes(serializedData)); // Correct for ethers v6
  return hash;
}

/**
 * Encrypts data using libsodium.
 * @param {string | Uint8Array} data The data to encrypt.
 * @param {Uint8Array} key The encryption key.
 * @returns {Uint8Array} The ciphertext.
 */
async function encryptData(data, key) {
  await libsodium.ready;
  const nonce = randomBytes(libsodium.crypto_secretbox_NONCEBYTES); // Use a different nonce for each encryption!
  const messageBytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  const ciphertext = libsodium.crypto_secretbox_easy(messageBytes, nonce, key);
  return new Uint8Array([...nonce, ...ciphertext]); // Prepend the nonce to the ciphertext
}

/**
 * Decrypts data using libsodium.
 * @param {Uint8Array} ciphertextWithNonce The ciphertext with the prepended nonce.
 * @param {Uint8Array} key The encryption key.
 * @returns {string} The decrypted data.
 */
async function decryptData(ciphertextWithNonce, key) {
  await libsodium.ready;
  const nonce = ciphertextWithNonce.slice(
    0,
    libsodium.crypto_secretbox_NONCEBYTES
  );
  const ciphertext = ciphertextWithNonce.slice(
    libsodium.crypto_secretbox_NONCEBYTES
  );
  const decryptedBytes = libsodium.crypto_secretbox_open_easy(
    ciphertext,
    nonce,
    key
  );
  return new TextDecoder().decode(decryptedBytes); // Convert back to string
}

// --- Class Definitions ---

class Enclave {
  constructor(address, provider) {
    this.address = address;
    this.provider = provider;
    this.contract = new ethers.Contract(address, EnclaveServiceABI, provider);
  }

  async getConfig() {
    const config = await this.contract.getAttestationConfig();
    return config; // { maxAttestationAge, expectedNonce, requireNonce, verifyCodeHash }
  }
}

class Courier extends Enclave {
  constructor(address, provider, apiKey = null, encryptionKey = null) {
    super(address, provider);
    this.apiKey = apiKey;
    this.encryptionKey = encryptionKey; // Store the encryption key
    this.contract = new ethers.Contract(address, CourierABI, provider);
  }

  async makeRequest(airnode, endpointId, encodedParameters, inputData) {
    const commitmentHash = generateCommitmentHash(inputData);

    let encryptedData = null;
    //const config = await this.contract.getAttestationConfig(); //Not needed

    if (this.encryptionKey) {
      encryptedData = await encryptData(
        JSON.stringify(inputData.parameters),
        this.encryptionKey
      ); //  Encrypt only the 'parameters'
    }

    const tx = await this.contract.makeRequest(
      airnode,
      endpointId,
      encodedParameters,
      encryptedData ? encryptedData : JSON.stringify(inputData.parameters),
      commitmentHash,
      {
        gasLimit: 3000000, //  Add a gas limit.  Adjust as needed.
      }
    );

    const receipt = await tx.wait();
    return receipt;
  }
}

class Custodian extends Enclave {
  constructor(address, provider, apiKey = null, encryptionKey = null) {
    super(address, provider);
    this.apiKey = apiKey;
    this.encryptionKey = encryptionKey; // Store the encryption key
    this.contract = new ethers.Contract(address, CustodianABI, provider);
    //this.ocean = new Ocean.Ocean(...); // Initialize Ocean.js -  Move to a separate function or method.
  }

  async createCertifiedPackage(
    owner,
    assetIds,
    metadataURI,
    preProcessingInstructions,
    postProcessingInstructions,
    teeAttestation,
    teeAttestationSignature,
    options = {}
  ) {
    const inputData = {
      dataType: "CustodianData", //  Define a suitable dataType
      source: "UserProvided", // Or another appropriate source
      parameters: {
        preProcessingInstructions,
        postProcessingInstructions,
        assetIds,
        metadataURI,
      },
      timestamp: Math.floor(Date.now() / 1000),
      requestId: uuidv4(),
      contractAddress: this.address,
    };
    const commitmentHash = generateCommitmentHash(inputData);
    //const config = await this.contract.getAttestationConfig(); //not needed

    let encryptedData = null;
    if (this.encryptionKey) {
      encryptedData = await encryptData(
        JSON.stringify(inputData.parameters),
        this.encryptionKey
      ); //  Encrypt
    }

    const tx = await this.contract.createCertifiedPackage(
      owner,
      assetIds,
      metadataURI,
      encryptedData ? encryptedData : JSON.stringify(inputData.parameters),
      encryptedData ? encryptedData : JSON.stringify(inputData.parameters),
      teeAttestation,
      teeAttestationSignature,
      commitmentHash,
      {
        gasLimit: 3000000, //  Add a gas limit. Adjust as needed.
      }
    );

    const receipt = await tx.wait();
    return receipt;
  }

  async getDataNFTMetadata(dataNFTAddress) {
    // Placeholder for Ocean.js integration.
    // const ddo = await this.ocean.assets.resolve(dataNFTAddress); // Example using did
    // return ddo;

    //For MVP return dummy data
    return {
      name: "Dummy Data NFT",
      description: "This is a placeholder for Ocean.js integration.",
      author: "Convenir MVP",
    };
  }
  async checkAccessPermissions(dataNFTAddress, userAddress) {
    // Placeholder for Ocean.js integration.
    // Use Ocean.js to check permissions, potentially involving datatokens.
    // This is a placeholder; the exact implementation depends on Ocean's access control mechanisms.

    //For MVP return true
    return true; // Replace with actual permission check
  }
}

class ProvenanceExplorer {
  constructor(providerUrl) {
    this.provider = new ethers.JsonRpcProvider(providerUrl); //v6
  }

  async getProvenanceRecord(txHash) {
    const tx = await this.provider.getTransaction(txHash);
    const receipt = await this.provider.getTransactionReceipt(txHash);
    return { tx, receipt };
  }
}

export {
  generateCommitmentHash,
  encryptData,
  decryptData,
  Enclave,
  Courier,
  Custodian,
  ProvenanceExplorer,
};
